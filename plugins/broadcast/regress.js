// Broadcast plugin regression suite — run by tests/regress.js (never loaded in
// production). Verifies the plugin's VINE nodes landed in the AI runner's
// registry (they were moved out of the engine's ai-behaviour.js switch), and
// that an off-shift studio actor walks out of the studio building.
import { readFileSync, readdirSync } from 'fs';
import { getRegisteredAINodes, tickEntityAI, initBlackboard } from '../../server/engine/ai-behaviour.js';
import { world, getZone, getZoneFurniture, moveNpcToZone, updateFurniture } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { ensureClipBroadcast, _test, _piracyTest, startEmergency, stopEmergency, emergencyActive, emergencyStatus, getTvChannelList, getTabletTunedChannel, isDeckInputChannel } from './index.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
const tabletTunersClear = (id) => _test.tabletTuners.delete(id);
import { getCrimeStars, getCrimeWitness } from '../../server/engine/crimes.js';
import { _audienceTest } from './audience.js';
import { TANGENT_POOLS, WRANGLE_POOLS, canTangent, tangentRuns, wrangleLines, buildTangent, tangentHoldMs } from './tangents.js';
import { rowIsInstanced, NOT_INSTANCED_SQL } from '../../server/engine/inventory.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';

export default async function regress({ check, run, getPlayer }) {
  // ── The VCR input is not a station ──────────────────────────────────────────
  // Channel 0 is the input on the back of the set. EVERY deck in the world points
  // flags.channel_id at that one row, so anything that treats it as a schedulable
  // channel drives every VCR in Coldwater in lockstep — and the eject path's
  // `DELETE FROM media_channel_playlist WHERE channel_id=…` would let a tape
  // ejected in one apartment wipe slots a deck across town was reading.
  {
    const { rows: zeroes } = await query('SELECT id FROM media_channels WHERE number = 0');
    for (const ch of zeroes) {
      check(`vcr: channel 0 '${ch.id}' is treated as a deck input, not a station`,
        isDeckInputChannel(ch.id), ch.id);
      const { rows: pl } = await query('SELECT count(*)::int AS n FROM media_channel_playlist WHERE channel_id=$1', [ch.id]);
      check(`vcr: channel 0 '${ch.id}' carries no schedule`, pl[0].n === 0, `${pl[0].n} slot(s)`);
    }
    const { rows: real } = await query('SELECT id FROM media_channels WHERE number IS NOT NULL AND number <> 0 LIMIT 1');
    if (real.length) check('vcr: a real station is NOT a deck input', !isDeckInputChannel(real[0].id), real[0].id);

    // ── A VCR answers for channel 0 and NOTHING else ──────────────────────────
    // The viewer's-room lookup used to fall back to "any deck in the room", so the
    // betamax under the set served its tape on every channel the TV could tune —
    // THE METER READER pre-empted the station on channel 7. A deck only speaks for
    // the channel it is plugged into.
    if (zeroes.length && real.length) {
      const { rows: vcrs } = await query(
        `SELECT id, zone_id FROM furniture WHERE flags->>'media_deck'='true' AND flags->>'channel_id'=$1 LIMIT 1`,
        [zeroes[0].id]
      );
      if (vcrs.length) {
        const z = vcrs[0].zone_id;
        check('vcr: a room VCR serves its own input channel',
          _test.zoneDeck(z, zeroes[0].id, true)?.id === vcrs[0].id, `${z} / ${zeroes[0].id}`);
        check('vcr: a room VCR does NOT answer for a real station',
          _test.zoneDeck(z, real[0].id, true) === null, `${z} leaked onto ${real[0].id}`);
      }
    }
  }

  // ── A screen fed from another room, and the late show ───────────────────────
  // Midway Parks's tape player stands in the projection box and its screen hangs in the
  // auditorium. The screen names the deck that feeds it (`deck_feed`) and the viewer's-room
  // lookup follows it; nothing else does. The deck's programme puts Sister Steel on at ten on
  // Friday and Saturday nights, and The Meter Reader the rest of the time.
  {
    const deck = world.furniture.get('furn_reel_deck');
    if (deck) {
      const fed = _test.zoneDeck('zone_reel_house', 'ch_0_vcr', true);
      check('deck feed: the auditorium screen shows the projection box deck', fed?.id === 'furn_reel_deck', fed?.id);
      check('deck feed: a verb in the auditorium finds no deck there', _test.zoneDeck('zone_reel_house') === null);
      check('deck feed: and the feed carries channel 0 only', _test.zoneDeck('zone_reel_house', 'ch_7_1782953079593', true) === null);
      const at = (dayOfWeek, h) => ({ dayOfWeek, minutes: h * 60 });
      check('deck programme: Friday at 22:30 the late show is Sister Steel', _test.deckWants(deck.flags, at(5, 22.5)) === 'bc_sister_steel');
      check('deck programme: Friday at 21:00 it is the house tape', _test.deckWants(deck.flags, at(5, 21)) === deck.flags.deck_default);
      check('deck programme: Thursday has no late show', _test.deckWants(deck.flags, at(4, 22.5)) === deck.flags.deck_default);
      check('deck programme: a showing whose tape somebody took falls back to the house tape',
        _test.deckWants({ ...deck.flags, deck_cassettes: [deck.flags.deck_default] }, at(5, 22.5)) === deck.flags.deck_default);
      check('deck programme: each night\'s showing is its own edge',
        _test.deckShowing(deck.flags, at(5, 22.5))?.key === 'fri:22' && _test.deckShowing(deck.flags, at(6, 23))?.key === 'sat:22');
    }
  }

  // ── A TAPE MAY NOT SHADOW ANOTHER LEAGUE'S SCHEDULED GAME ───────────────────
  // The deck outranks the schedule and a cassette carries no day mask, only its
  // script's airSlots — so a Deadball tape left in KSAB's own deck offered a ballgame
  // in the 18:00 block on the three nights that belong to Cluster Puck. Both walk the
  // SAME channel blackboard, which tickBroadcastGraph resets and re-seeks on every
  // change of _broadcastId, so the two flipped tick by tick and neither ever got past
  // its title card. What reached the viewer was the OFF-AIR card — a dead channel
  // rather than the wrong programme, which is why it read as an engine fault.
  //
  // Empty airSlots means continuous, so these two fixtures are airing at any slot. Whether
  // the slot has a game to air is the slate's (below).
  //
  // ⚠ THE BLACKBOARD IS THE ASSERTION, NOT THE RETURN VALUE. Both outcomes answer null
  // here — a refused tape because the guard returned early, an accepted one because the
  // walker's first tick seeks and yields nothing — so a check on the result passes
  // whatever the guard does. `activeBroadcastId` is stamped only once a graph reaches
  // tickBroadcastGraph, which is exactly the question: did the tape get near the
  // channel's blackboard at all.
  {
    const chId = 'regress-deck-shadow';
    const mkScript = (sport) => ({ sport, teams: ['A', 'B', 'C', 'D'], players: [], pools: {}, airSlots: [] });
    const mkItem = (sport) => ({ playback_mode: 'sports', sportsScript: mkScript(sport), messages: [], message_interval: 5 });
    const freshBB = () => ({ currentNode: null, waitUntil: null, npcAnchor: null, npcAnchorId: null,
      activeBroadcastId: null, hostAbsent: false, absentDetectedAt: null, techDiffMode: false,
      standbyCardUp: false, airedAny: false });
    const state = { channelId: chId, playlist: [mkItem('hockey')], graphBlackboard: freshBB(),
      channelType: 'playlist', scheduleMode: 'daily' };
    _test.channelRuntime.set(chId, state);
    try {
      check('deck: the channel reports the sport its own schedule has on air',
        _test.sportOnChannel(chId) === 'hockey', String(_test.sportOnChannel(chId)));

      _test.playDeckItem(mkItem('baseball'), state, Date.now());
      check('deck: a baseball tape never reaches the blackboard on a hockey night',
        state.graphBlackboard.activeBroadcastId === null,
        `the tape took the channel as '${state.graphBlackboard.activeBroadcastId}'`);

      // Same sport, no conflict: on a Deadball night the tape and the slot are one
      // broadcast, which is why only the hockey nights broke. The guard must not
      // swallow that case too. Since the daily slate a sports graph exists only in a slot the
      // slate gives that sport a game, so this half depends on the clock after all: asked in
      // a Deadball or empty slot, getSportsGraph has no game and nothing reaches the
      // blackboard whatever the guard does. It checks in hockey slots only.
      const slot = _test.sportsSlotIndex();
      if (_test.sportsMatchupForSlot(slot, mkScript('hockey').teams, 'hockey')) {
        state.graphBlackboard = freshBB();
        _test.playDeckItem(mkItem('hockey'), state, Date.now());
        check('deck: a hockey tape still plays on a hockey night',
          String(state.graphBlackboard.activeBroadcastId || '').startsWith('hockey:'),
          String(state.graphBlackboard.activeBroadcastId));
      }
    } finally {
      _test.channelRuntime.delete(chId);
    }
  }

  // ── Deterministic DEADBALL league ───────────────────────────────────────────
  // Every game is a pure function of its slot: same slot → byte-identical result on
  // every server and every TV (this is what keeps all TVs in sync and lets the
  // standings be a zero-write computed fold).
  const script = { teams: ['Rats', 'Kings', 'Wolves', 'Slaggers', 'Ash', 'Moles', 'Wolv2', 'Drowners'], players: [], pools: {} };
  const a = _test.sportsGameForSlot(script, 12345, null);
  const b = _test.sportsGameForSlot(script, 12345, null);
  check('same slot → identical matchup', a && b && a.game.away.name === b.game.away.name && a.game.home.name === b.game.home.name, JSON.stringify([a?.matchup, b?.matchup]));
  check('same slot → identical score', a.game.awayScore === b.game.awayScore && a.game.homeScore === b.game.homeScore, `${a.game.awayScore}-${a.game.homeScore} vs ${b.game.awayScore}-${b.game.homeScore}`);
  check('sim never ties', a.game.awayScore !== a.game.homeScore, `${a.game.awayScore}-${a.game.homeScore}`);
  // a final's finalists come in seeded order, and the top seed is the home side
  const fin = _test.sportsGameForSlot(script, 12345, { teams: ['Kings', 'Rats'], worldSeries: true });
  check('a final: the top seed hosts', fin && fin.game.home.name === 'Kings' && fin.game.away.name === 'Rats', JSON.stringify(fin?.matchup));
  // 12346 is the other sport's slot on the slate, so the next Deadball game is 12347.
  check('the other sport\'s slot has no Deadball game', _test.sportsGameForSlot(script, 12346, null) === null, 'slot 12346');
  const c = _test.sportsGameForSlot(script, 12347, null);
  check('a different slot rolls a different game',
    a.game.away.name !== c.game.away.name || a.game.home.name !== c.game.home.name || a.game.awayScore !== c.game.awayScore || a.game.homeScore !== c.game.homeScore,
    'adjacent slots differ');

  // ── The v1 fingerprint ──────────────────────────────────────────────────────
  // A hundred seeded games and four finals, every at-bat and every synthesised pitch,
  // hashed. The standings, the recap reel and the team cards all re-simulate past
  // slots, so a change that moves any of these rewrites games that have already aired.
  // A new version of the sim switches on at a recorded slot instead
  // (docs/proposals/deadball-glass2.md); this pins v1 for every slot before it. If it
  // fails, the sim or the pitch synthesis changed for games already played.
  {
    const { sportsHash } = await import('./rng.js');
    const { BASEBALL } = await import('./sports/baseball.js');
    const fnv = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16).padStart(8, '0'); };
    // This pins the SIM, not the schedule. The daily slate (2026-10) replaced the matchups
    // every slot used to get, so the hundred games are played with the matchups they aired
    // with, from the old one-round-robin-a-day schedule kept here, passed in as explicit
    // teams. That gives the same seed and the same game as before.
    const { sportsRng, sportsShuffle } = await import('./rng.js');
    const airedMatchup = (slot) => {
      const order = sportsShuffle(script.teams, sportsRng(sportsHash(Math.floor(slot / 8), 0x5c4e)));
      const rounds = _test.roundRobinRounds(order.length);
      const total = rounds.length * rounds[0].length;
      const flat = (Math.floor(slot / 8) * 2 * rounds[0].length + (slot % 8)) % total;
      const [ai, hi] = rounds[Math.floor(flat / rounds[0].length)][flat % rounds[0].length];
      return (sportsHash(slot, 0xa17f) & 1) === 1 ? [order[ai], order[hi]] : [order[hi], order[ai]];   // [home, away]
    };
    const fpGame = (slot, override) => {
      const gs = _test.sportsGameForSlot(script, slot, override || { teams: airedMatchup(slot) });
      const g = gs.game, ab = [];
      let idx = 0;
      for (const bt of g.beats) {
        if (bt.type === 'half_start') { idx = 0; continue; }
        if (bt.type !== 'atbat') continue;
        const pitches = BASEBALL.synthDetail(sportsHash(gs.seed, bt.inning * 2 + (bt.half === 'bottom' ? 1 : 0), idx++ >>> 0), bt.kind);
        ab.push([bt.inning, bt.half, bt.batter, bt.pitcher, bt.kind, bt.outs, bt.rbi, bt.bases.map(Number).join(''), bt.walkoff ? 1 : 0,
          pitches.map((p) => `${p.type}|${p.velo}|${p.x}|${p.y}|${p.result}`).join(';')]);
      }
      return JSON.stringify([g.away.name, g.home.name, g.awayScore, g.homeScore, g.innings, ab]);
    };
    // v1, whatever switch this database has recorded.
    const recorded = _test.getSimSwitch('baseball');
    _test.setSimSwitch('baseball', null);
    let all = '';
    try {
      for (let k = 0; k < 100; k++) all += fpGame(40000 + k * 97);
      // a final's teams come top seed first, and the top seed hosts (2026-10-14): Kings at home to
      // Rats, the same four games these always were
      for (let k = 0; k < 4; k++) all += fpGame(50000 + k * 13, { worldSeries: true, teams: ['Kings', 'Rats'] });
    } finally {
      _test.setSimSwitch('baseball', recorded);
    }
    check('deadball v1: a hundred seeded games play exactly as they aired', fnv(all) === '11e200d9', `fingerprint ${fnv(all)}`);
  }

  // A round-robin round has every team exactly once (balanced schedule, not random).
  const rounds = _test.roundRobinRounds(8);
  check('round-robin: N-1 rounds', rounds.length === 7, String(rounds.length));
  const seen = new Set(rounds[0].flat());
  check('round-robin: every team plays once per round', rounds[0].length === 4 && seen.size === 8, JSON.stringify(rounds[0]));

  // A matchup is a real pairing of two distinct teams from the roster.
  const m = _test.sportsMatchupForSlot(998, script.teams);
  check('matchup picks two distinct roster teams', m && m.away !== m.home && script.teams.includes(m.away) && script.teams.includes(m.home), JSON.stringify(m));

  // Featured-slot airing gate: no airSlots ⇒ continuous; an out-of-range set ⇒ dark now,
  // a full-range set ⇒ always airing (whatever the current slot-of-day is).
  check('no airSlots airs continuously', _test.sportsAiring({}) === true && _test.sportsAiring({ airSlots: [] }) === true, 'continuous');
  const allSlots = Array.from({ length: _test.SPORTS_GAMES_PER_DAY }, (_, i) => i);
  check('featuring every slot always airs', _test.sportsAiring({ airSlots: allSlots }) === true, 'all-slots');
  check('featuring no valid slot never airs', _test.sportsAiring({ airSlots: [-1] }) === false, 'empty-window');

  // ── The network's open ──────────────────────────────────────────────────────
  // A sports script's @theme rides its title card as the news's does, and the card holds for
  // it. Deadball's is KSAB-7 Sports' theme (scripts/content/build-ksab-theme.mjs), 19 bars at
  // 132 bpm; the open drawn on the card is cut to the same length.
  {
    const deadball = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_1783289744953.json', import.meta.url), 'utf8')).sports_pools;
    const g = _test.assembleSportsGraph(deadball, 'bc_regress_open', 40002, null);
    const card = g && Object.values(g.nodes).find((n) => n.type === 'title_card');
    check('network open: Deadball\'s title card carries its theme', card?.data?.theme === 'ksab7_deadball_theme' && card?.data?.graphic_id === 'bb_deadball_title', JSON.stringify(card?.data));
    const hold = card ? _test.nodeHoldMs(card) : 0;
    check('network open: the card holds for the whole theme', Math.abs(hold - (19 * 16 * 60000) / 132 / 4) < 1, String(hold));
  }
  // Cluster Puck's is the network's hockey theme (scripts/content/build-cphl-theme.mjs), 16 bars at
  // 150 bpm, and the row has to say so as the script does: the row is what ships.
  {
    const row = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools;
    const bsm = readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
    const theme = (/^@theme\s+(\S+)/m.exec(bsm) || [])[1];
    check('network open: the hockey row plays the theme its script names', theme === 'ksab7_cphl_theme' && row.theme === theme, `${row.theme} vs ${theme}`);
    const g = _test.assembleSportsGraph(row, 'bc_regress_open_cphl', 42, null);
    const card = g && Object.values(g.nodes).find((n) => n.type === 'title_card');
    check('network open: Cluster Puck\'s title card carries its theme', card?.data?.theme === 'ksab7_cphl_theme' && card?.data?.graphic_id === 'cphl_title', JSON.stringify(card?.data));
    const hold = card ? _test.nodeHoldMs(card) : 0;
    check('network open: the hockey card holds for the whole theme', Math.abs(hold - (16 * 16 * 60000) / 150 / 4) < 1, String(hold));
  }

  // ── The pregame open ──────────────────────────────────────────────────────
  // Both sports put the open (index.js pregameFx) on the first line after the title card: the
  // two clubs playing and the league table, held until the first pitch or the drop. A plain
  // night's matchup line carries no card of its own, or it would knock the open off the screen.
  for (const [file, id, seed, sport] of [['bc_1783289744953', 'bc_regress_pg', 40002, 'baseball'], ['bc_cluster_puck', 'bc_regress_pg_cphl', 42, 'hockey']]) {
    const row = JSON.parse(readFileSync(new URL(`../../content/media_broadcasts/${file}.json`, import.meta.url), 'utf8')).sports_pools;
    const g = _test.assembleSportsGraph(row, id, seed, null);
    const says = g ? Object.values(g.nodes).filter((n) => n.type === 'say') : [];
    const gfx = (n) => n.data?.graphic || n.graphic || null;
    const open = says.map(gfx).find((x) => x?.kind === 'pregame');
    check(`pregame open: ${sport} airs one`, !!open && open.sport === sport && !!open.away?.name && !!open.home?.name && open.away.name !== open.home.name, JSON.stringify(open)?.slice(0, 200));
    // the first spoken line is the venue's ("Live from …"), and the open goes up with the next
    check(`pregame open: ${sport} puts it on the first line after the venue's`, gfx(says[0] || {})?.kind === 'live' && gfx(says[1] || {})?.kind === 'pregame', JSON.stringify([gfx(says[0] || {}), gfx(says[1] || {})])?.slice(0, 160));
    check(`pregame open: ${sport} holds long enough to read`, open?.duration >= 12, String(open?.duration));
  }
  {
    const rows = Array.from({ length: 10 }, (_, i) => ({ team: `Club ${i + 1}`, wins: 10 - i, losses: i, otl: 1, points: 21 - 2 * i }));
    const fx = _test.pregameFx('hockey', rows, { away: 'Club 2', home: 'Club 10', awayRecord: '9-1-1', homeRecord: '1-9-1', brand: 'cphl' });
    check('pregame open: the table is the top eight plus a club below it that plays tonight',
      fx.rows.length === 9 && fx.rows[8].team === 'Club 10' && fx.rows[8].rank === 10 && fx.home.rank === 10 && fx.away.rank === 2, JSON.stringify(fx.rows.map((r) => r.rank)));
    const log = _test.pregameLines(fx);
    check('pregame open: the log rung gets it written out', /TONIGHT/.test(log) && log.includes('Club 2 (9-1-1) at Club 10') && log.includes('<b>') && /21 pts/.test(log), log);
    check('pregame open: opening night still names the clubs', /Away A at Home B/.test(_test.pregameLines(_test.pregameFx('baseball', [], { away: 'Away A', home: 'Home B', awayRecord: '0-0', homeRecord: '0-0' }))));
    check('pregame open: any other card writes nothing to the log', _test.pregameLines({ kind: 'matchup' }) === null && _test.pregameLines(null) === null);
  }

  // ── Live from the venue, and the final's package ────────────────────────────
  // Every game opens "Live from" its park (sports_pools.venue.said), and that line carries the
  // fly-in (a gameday payload with `phase: 'arrive'`) and the LIVE card. Every CPhL game is played
  // at Golden Goose Gardens, so the clubs' colour pools are about the clubs, never a barn of their
  // own. A final reads its package (sports/final-package.js) over three cards before the first
  // pitch or the drop: the tale of the tape, the road here, the men to watch.
  {
    const rowOf = (file) => JSON.parse(readFileSync(new URL(`../../content/media_broadcasts/${file}.json`, import.meta.url), 'utf8')).sports_pools;
    const gfx = (n) => n.data?.graphic || n.graphic || null, gdOf = (n) => n.data?.gameday || n.gameday || null, txt = (n) => n.data?.text || n.text || '';
    for (const [file, sport, seed] of [['bc_1783289744953', 'baseball', 40002], ['bc_cluster_puck', 'hockey', 42]]) {
      const row = rowOf(file);
      const g = _test.assembleSportsGraph(row, `bc_regress_live_${sport}`, seed, null);
      const first = g ? Object.values(g.nodes).find((n) => n.type === 'say') : null;
      const gd = first && gdOf(first);
      check(`live: ${sport} opens "Live from ${row.venue?.said}"`, !!row.venue?.said && txt(first || {}).startsWith(`Live from ${row.venue.said}`), txt(first || {}));
      check(`live: ${sport}'s line carries the fly-in and the LIVE card`, gd?.phase === 'arrive' && gd.venue === row.venue.name && gfx(first)?.kind === 'live', JSON.stringify([gd, gfx(first || {})])?.slice(0, 200));
    }
    const puck = rowOf('bc_cluster_puck');
    const b = puck.venue?.site?.block;
    check('live: the CPhL plays at Golden Goose Gardens, on its six tiles', puck.venue?.name === 'Golden Goose Gardens' && b?.x0 === 914 && b?.x1 === 916 && b?.y0 === 916 && b?.y1 === 917);
    const clubKey = (name) => `chatter.${String(name).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const barns = puck.teams.flatMap((t) => (puck.pools[clubKey(t)] || []).filter((l) => /\bbarn\b/i.test(l)));
    check('live: every CPhL club has a colour pool, and none of it is about a barn of its own', puck.teams.every((t) => (puck.pools[clubKey(t)] || []).length >= 3) && !barns.length, barns.join(' | '));

    // the package's arithmetic, pure
    const { formOf, streakOf, seriesOf, finalPackage } = await import('./sports/final-package.js');
    const res = [{ a: 'A', h: 'B', as: 3, hs: 1 }, { a: 'B', h: 'A', as: 2, hs: 1, ot: 1 }, { a: 'C', h: 'A', as: 0, hs: 4 }, { a: 'A', h: 'B', as: 5, hs: 2 }];
    check('package: form is W, L and O oldest first, and an overtime loss ends a run of wins', formOf(res, 'A').join('') === 'WOWW' && formOf(res, 'B').join('') === 'LWL' && JSON.stringify(streakOf(formOf(res, 'A'))) === '{"kind":"W","n":2}', formOf(res, 'A').join(''));
    const ser = seriesOf(res, 'A', 'B');
    check('package: the season series counts only the two clubs\' meetings', ser.games.length === 3 && ser.wins.A === 2 && ser.wins.B === 1, JSON.stringify(ser.wins));
    const pk = finalPackage({ sport: 'hockey', final: 'Cup', away: 'A', home: 'B', results: res,
      rows: [{ team: 'A', wins: 3, losses: 0, otl: 1, points: 7, goals_for: 13, goals_against: 5 }, { team: 'B', wins: 1, losses: 2, otl: 0, points: 2, goals_for: 5, goals_against: 9 }],
      seeds: { away: 1, home: 2 }, watch: { away: [{ role: 'F', name: 'Ace', stat: '9 G', said: '9 goals' }] }, out: { home: ['Hurt'] } });
    check('package: three pages, tape then road then men', pk.pages.map((p) => p.page).join() === 'tape,road,watch' && pk.pages[0].away.diff === 8 && pk.pages[0].away.record === '3-0-1');
    check('package: one line a club a page, the series, the men and who is out',
      pk.lines.map((l) => l.key).join() === 'tape.club,tape.club,road.club,road.club,series,watch.club.one,watch.out', pk.lines.map((l) => l.key).join());
    check('package: the road reads its last ten aloud, overtime losses and all', pk.lines[2].tok.last10 === '3, 0 and 1' && pk.lines[3].tok.last10 === '1 and 2', `${pk.lines[2].tok.last10} | ${pk.lines[3].tok.last10}`);
    check('package: each page writes itself out for the log rung', pk.pages.every((p) => /THE TALE|THE ROAD|PLAYERS/.test(_test.packageLines(p) || '')) && _test.packageLines({ kind: 'pregame' }) === null);

    // and a real final, over a season the suite folds itself
    for (const [file, sport, prefix] of [['bc_cluster_puck', 'hockey', 'cup.'], ['bc_1783289744953', 'baseball', 'worldseries.']]) {
      const row = rowOf(file), now = 60000;
      const keepS = _test.standingsCaches.get(sport), keepW = _test.seasonCaches.get(sport);
      try {
        const res2 = await dispatchAction({ type: 'broadcast.computeStandings', params: { startSlot: now - 160, endSlot: now, sport } });
        const { rows, sport: _s, ...extras } = res2 || {};
        _test.standingsCaches.set(sport, { at: Date.now() + 1e9, rows, extras });
        const [a, b2] = [rows[0].team, rows[1].team];
        _test.seasonCaches.set(sport, { at: Date.now() + 1e9, phase: 'worldseries', finalistA: a, finalistB: b2, wsSlot: now, seasonNo: 1 });
        let g = null;
        for (let slot = now; slot < now + 40 && !g; slot++) g = _test.assembleSportsGraph(row, `bc_regress_pkg_${sport}`, slot, { teams: [a, b2], worldSeries: true });
        const says = g ? Object.values(g.nodes).filter((n) => n.type === 'say') : [];
        const pages = says.map(gfx).filter((x) => x?.kind === 'package');
        check(`package: ${sport}'s final puts up the three pages in order`, pages.map((p) => p.page).join() === 'tape,road,watch', pages.map((p) => p.page).join());
        check(`package: ${sport}'s final drops the table for them`, !says.some((n) => gfx(n)?.kind === 'pregame'));
        const lines = says.map(txt).filter((t) => /\{|undefined|null/.test(t));
        check(`package: ${sport}'s lines fill every token`, !lines.length && pages.length === 3, lines.join(' | '));
        check(`package: ${sport} names each club's men from the season`, pages[2]?.away?.men?.length >= 2 && pages[2]?.home?.men?.length >= 2, JSON.stringify(pages[2])?.slice(0, 1200));
        check(`package: ${sport} has a pool for every key it reads`, ['tape.club', 'road.club', 'series', 'series.even', 'series.none', 'watch.club', 'watch.club.one', 'live'].every((k) => (row.pools[prefix + k] || []).length));
      } finally {
        if (keepS) _test.standingsCaches.set(sport, keepS); else _test.standingsCaches.delete(sport);
        if (keepW) _test.seasonCaches.set(sport, keepW); else _test.seasonCaches.delete(sport);
      }
    }
  }

  // ── Deadball's booth between the plays ─────────────────────────────────────
  // sports/baseball-booth.js and baseball-pacing.js. The freeze this fixed: every line held the
  // slot's even share (22 s at 3:1, 67 s at 1:1), the park played the at-bat in the first 13 to 26
  // and stood still for the rest, and a line of chatter stood it still for a whole hold. Played
  // at the live clock (a 1-hour slot) and at 1:1 (3 hours), with the real script.
  {
    const deadball = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_1783289744953.json', import.meta.url), 'utf8')).sports_pools;
    const { landBy, afterLand } = await import('../../client/game/js/panels/diamond/timing.js');
    const { holdFor: bbHold } = await import('./sports/baseball-pacing.js');
    const { pitcherStyleOf, PITCHER_STYLES } = await import('./sports/baseball.js');
    const inAir = (g) => { const nx = new Map(g.edges.filter((e) => e.fromPort === 'next').map((e) => [e.fromNode, e.toNode])); const out = []; for (let id = g._start; id; id = nx.get(id)) out.push(g.nodes[id].data); return out; };
    for (const [clock, slotMs] of [['3:1', 3600000], ['1:1', 10800000]]) {
      // two slots the slate gives baseball
      const slots = [];
      for (let sl = 40002; slots.length < 2 && sl < 40200; sl += 7) if (_test.assembleSportsGraph(deadball, 'bc_regress_booth_probe', sl, null, { slotMs })) slots.push(sl);
      for (const slot of slots) {
        const g = _test.assembleSportsGraph(deadball, `bc_regress_booth_${slot}`, slot, null, { slotMs });
        const air = inAir(g).filter((d) => d.text != null || d.gameday);
        const total = air.reduce((a, d) => a + (d.holdMs || 0), 0);
        // (a changeover and the fly-in to the park before the first pitch aren't plays)
        const plays = air.map((d, i) => [d, i]).filter(([d]) => d.gameday && d.gameday.phase !== 'half' && d.gameday.phase !== 'arrive');
        const tag = `booth ${clock} #${slot}`;
        check(`${tag}: the game fits its slot`, total <= slotMs, `${total} > ${slotMs}`);
        // every plate appearance in regulation is on air, so the park never jumps a man
        const regPAs = plays.filter(([d]) => !d.gameday.phase && d.gameday.inning <= 9).length;
        const gs = _test.sportsGameForSlot(deadball, slot, null);
        const simPAs = gs.game.beats.filter((b) => b.type === 'atbat' && b.inning <= 9).length;
        check(`${tag}: every plate appearance is called`, regPAs === simPAs, `${regPAs} of ${simPAs}`);
        // a payload's hold runs to the next one, and the play and its call fit inside it
        const bad = [];
        for (let k = 0; k < plays.length; k++) {
          const [d, i] = plays[k];
          let next = i + 1;
          while (next < air.length && !air[next].gameday) next++;
          let span = 0, toCallEnd = 0, callAt = -1;
          for (let j = i; j < next; j++) span += air[j].holdMs || 0;
          if (d.gameday.lead) callAt = air.findIndex((x, j) => j > i && j < next && x.call);
          else callAt = i;
          for (let j = i; j <= callAt; j++) toCallEnd += air[j].holdMs || 0;
          const land = landBy({ ...d.gameday, hold: span }) * 1000;
          const need = land + bbHold(air[callAt]?.text || '') - 1000;
          // and the next payload waits for what the park does after the landing (a home run's trot)
          if (next < air.length && span + 1000 < land + afterLand(d.gameday) * 1000) bad.push(`${d.gameday.kind}@${i}: span ${span} leaves the park no time after the landing`);
          // (the last payload's hold runs on through the final and the recap reel)
          if ((next < air.length && span !== d.gameday.hold) || callAt < 0 || (next < air.length && toCallEnd < need)) bad.push(`${d.gameday.kind}@${i}: span ${span}/${d.gameday.hold} call ${callAt} ${toCallEnd}<${Math.round(need)}`);
        }
        check(`${tag}: each play's hold runs to the next payload and covers the pitches, the play and the call`, !bad.length, bad.slice(0, 4).join(' | '));
        const says = air.filter((d) => d.text);
        check(`${tag}: the colour man talks`, says.filter((d) => d.text.startsWith('Dusty Merriman says, "')).length >= (clock === '3:1' ? 40 : 120), String(says.filter((d) => d.text.startsWith('Dusty Merriman says')).length));
        check(`${tag}: no booth line leaves a token unfilled`, !says.some((d) => /\{\w+\}/.test(d.text)), says.find((d) => /\{\w+\}/.test(d.text))?.text);
        // (a short turn of an exchange, "And?", can come round again in another one)
        const talk = says.filter((d) => !d.gameday && !d.call && d.text.length > 30 && !d.scorebug?.status?.startsWith('FINAL'));
        const twice = talk.filter((d, k) => talk.findIndex((x) => x.text === d.text) !== k);
        check(`${tag}: no booth line airs twice in a game`, twice.length <= 2, twice.slice(0, 3).map((d) => d.text.slice(0, 60)).join(' | '));
      }
    }
    // A pitcher throws his own mix, and a strikeout ends on his out pitch more often than not.
    const g = _test.assembleSportsGraph(deadball, 'bc_regress_booth_mix', 40002, null, { slotMs: 3600000 });
    const abs = Object.values(g.nodes).map((n) => n.data?.gameday).filter((p) => p && Array.isArray(p.pitches));
    const offMix = abs.filter((p) => p.pitches.some((x) => !pitcherStyleOf(p.pitcher).mix.some(([t]) => t === x.type)));
    check('booth: every pitch is from its pitcher\'s mix', abs.length > 40 && !offMix.length, offMix.slice(0, 2).map((p) => `${p.pitcher}: ${p.pitches.map((x) => x.type).join(',')}`).join(' | '));
    const ks = abs.filter((p) => p.kind === 'strikeout');
    const onOut = ks.filter((p) => p.pitches[p.pitches.length - 1].type === pitcherStyleOf(p.pitcher).out).length;
    check('booth: strike three is usually the out pitch', ks.length > 5 && onOut / ks.length > 0.5, `${onOut}/${ks.length}`);
    const styles = new Set(Array.from({ length: 400 }, (_, i) => pitcherStyleOf(`Pitcher ${i}`).style));
    check('booth: every pitching style turns up', Object.keys(PITCHER_STYLES).every((s) => styles.has(s)), [...styles].join(','));
  }

  // ── The daily slate ─────────────────────────────────────────────────────────
  // docs/proposals/daily-slate.md. Sixty-two days over two month ends, with the real clubs.
  const G = _test.SPORTS_GAMES_PER_DAY;
  {
    const pools = (f) => JSON.parse(readFileSync(new URL(`../../content/media_broadcasts/${f}.json`, import.meta.url), 'utf8')).sports_pools;
    const db = pools('bc_1783289744953'), hk = pools('bc_cluster_puck');
    const d0 = Math.floor(Date.UTC(2035, 0, 1) / 86400000);
    const bad = [], spread = [];
    let month = null, tally = null, cupDays = 0;
    const closeMonth = () => { if (tally) for (const [sp, m] of Object.entries(tally)) { const v = [...m.values()]; spread.push([month, sp, Math.max(...v) - Math.min(...v), v.length]); } };
    for (let d = d0; d < d0 + 62; d++) {
      const m = new Date(d * 86400000).toISOString().slice(0, 7);
      if (m !== month) { closeMonth(); month = m; tally = { baseball: new Map(), hockey: new Map() }; }
      const day = _test.sportsSlateForDay(d, [db, hk]);
      const games = day.filter((g) => g.away);
      if (_test.isCupDay(d)) {
        cupDays++;
        const fin = day.filter((g) => g.final);
        if (games.length || fin.length !== 2 || fin.some((g) => g.sod < 6) || new Set(fin.map((g) => g.sport)).size !== 2) bad.push(`${m} Cup day ${JSON.stringify(day)}`);
        continue;
      }
      if (games.length !== 8) bad.push(`day ${d}: ${games.length} games`);
      for (const sp of ['baseball', 'hockey']) {
        const teams = games.filter((g) => g.sport === sp).flatMap((g) => [g.away, g.home]);
        if (new Set(teams).size !== teams.length) bad.push(`day ${d}: a ${sp} club plays twice`);
      }
      if (day[6].sport !== (d % 2 === 0 ? 'baseball' : 'hockey') || day[7].sport === day[6].sport) bad.push(`day ${d}: slots don't alternate`);
      for (const t of [day[6].away, day[6].home]) tally[day[6].sport].set(t, (tally[day[6].sport].get(t) || 0) + 1);
      for (const g of day) {
        const mm = _test.sportsMatchupForSlot(g.slot, (g.sport === 'baseball' ? db : hk).teams, g.sport);
        if ((mm?.away || null) !== g.away || (mm?.home || null) !== g.home) bad.push(`slot ${g.slot}: the lookup disagrees with the slate`);
      }
    }
    check('slate: 8 games a day, no club twice, sports alternating', bad.length === 0 && cupDays === 2, bad.slice(0, 4).join('; '));
    // Greedy, so not proven exact: measured at 1 or 2 across 2035's first two months.
    const wide = spread.filter(([, , s, n]) => s > 2 || n !== 8);
    check('slate: every club is on at 18:00 within two games of every other over a month', spread.length === 4 && !wide.length, JSON.stringify(spread));
    const cal = _test.seasonCalendar('baseball', (d0 + 30) * G + 2);
    check('calendar: the 31st is Cup day and the next season starts on the 1st', cal.isCupDay && cal.monthDays === 31 && cal.seasonStartDate === '2035-02-01' && cal.seasonStartSlot === (d0 + 31) * G, JSON.stringify(cal));
    check('calendar: each sport\'s final is in its last slot on Cup day', [cal.finalSlot, _test.seasonCalendar('hockey', d0 * G).finalSlot].sort().join() === [(d0 + 30) * G + 6, (d0 + 30) * G + 7].join(), String(cal.finalSlot));
    check('calendar: a Cup-day final is no regular game', _test.sportsMatchupForSlot(cal.finalSlot, db.teams, 'baseball') === null, String(cal.finalSlot));
    check('calendar: mid-month, the season started on the 1st', _test.seasonCalendar('hockey', (d0 + 40) * G).seasonStartSlot === (d0 + 31) * G, 'february');
  }

  // ── KSAB5's slate row and KSAB-TV's relay ───────────────────────────────────
  // docs/proposals/daily-slate.md. Built on throwaway channels so the dev DB's grid
  // doesn't matter; the day is whatever the world clock says, and every check reads the
  // slate for that day rather than assuming one.
  {
    const pools = (f) => JSON.parse(readFileSync(new URL(`../../content/media_broadcasts/${f}.json`, import.meta.url), 'utf8')).sports_pools;
    const lib = new Map([
      ['reg-bc-db', { id: 'reg-bc-db', name: 'Deadball', sports_pools: pools('bc_1783289744953') }],
      ['reg-bc-hk', { id: 'reg-bc-hk', name: 'Cluster Puck', sports_pools: pools('bc_cluster_puck') }],
    ]);
    const row = (id, extra) => ({ id, start_time: 0, duration_override: 86400, days: 127, priority: 0, ...extra });
    const slate = _test.scheduleRowItems(row('reg-slate', { slot_type: 'sports_slate' }), { broadcasts: ['reg-bc-db', 'reg-bc-hk'] }, lib);
    check('slate row: one item per broadcast, each marked for the slate',
      slate.length === 2 && slate.every((i) => i.playback_mode === 'sports' && i.sportsScript?._slate && i.slotType === 'sports_slate'), JSON.stringify(slate.map((i) => i.id)));
    const relay = (id, src) => _test.scheduleRowItems(row(id, { slot_type: 'relay', source_channel_id: src }), {}, lib);
    const chans = {
      'reg-ch-src': { channelId: 'reg-ch-src', name: 'Source TV', playlist: slate },
      'reg-ch-rel': { channelId: 'reg-ch-rel', name: 'Relay TV', playlist: relay('reg-relay', 'reg-ch-src') },
      'reg-ch-self': { channelId: 'reg-ch-self', name: 'Self TV', playlist: relay('reg-self', 'reg-ch-self') },
      'reg-ch-chain': { channelId: 'reg-ch-chain', name: 'Chain TV', playlist: relay('reg-chain', 'reg-ch-rel') },
      'reg-ch-dark': { channelId: 'reg-ch-dark', name: 'Dark TV', playlist: relay('reg-dark', 'reg-ch-empty') },
      'reg-ch-empty': { channelId: 'reg-ch-empty', name: 'Empty TV', playlist: [] },
    };
    for (const [id, st] of Object.entries(chans)) _test.channelRuntime.set(id, st);
    try {
      const today = Math.floor(_test.sportsSlotIndex() / G);
      const bad = [];
      for (let sod = 0; sod < G; sod++) {
        const secs = sod * 10800 + 600;
        const own = _test.pickDailySlot(slate, secs, 1);
        const want = slate.find((i) => _test.slateHasGame(i.sportsScript, today * G + sod)) || null;
        if (own !== want) bad.push(`slot ${sod}: picked ${own?.id || 'nothing'}, the slate has ${want?.id || 'nothing'}`);
        const r = _test.pickDailySlot(chans['reg-ch-rel'].playlist, secs, 1);
        const via = _test.relayedItem(chans['reg-ch-rel'], r, secs, 1);
        if ((via?.broadcastId || null) !== (own?.broadcastId || null)) bad.push(`slot ${sod}: the relay carries ${via?.broadcastId || 'nothing'}, the source ${own?.broadcastId || 'nothing'}`);
        if (via && !/ · via Source TV$/.test(via.broadcastName)) bad.push(`slot ${sod}: relay named "${via.broadcastName}"`);
      }
      check('slate row: each slot airs the sport with a game in it, and the relay carries the same', !bad.length, bad.slice(0, 3).join('; '));
      const at = (id) => _test.relayedItem(chans[id], chans[id].playlist[0], 600, 1);
      check('relay: a relay of its own channel carries nothing', at('reg-ch-self') === null);
      check('relay: a relay of a relay carries nothing (one hop)', at('reg-ch-chain') === null);
      check('relay: a source with nothing on gives the off-air card', at('reg-ch-dark') === null);
      // A month_end row airs on Cup day only.
      const cup = _test.scheduleRowItems(row('reg-cup', { slot_type: 'relay', source_channel_id: 'reg-ch-src', priority: 1 }), { calendar: 'month_end' }, lib);
      const onCup = _test.pickDailySlot(cup, 600, 1) === cup[0];
      check('relay: a month_end row airs only on the last day of the month', onCup === _test.isCupDay(today), `today ${today}, aired ${onCup}`);
      // The guide lists today's games, matchups only.
      const guide = _test.slateScheduleSlots(chans['reg-ch-src']);
      check('slate guide: lists today\'s games with clock times and no scores',
        Array.isArray(guide) && guide.every((g) => /^\d\d:00$/.test(g.todLabel) && !/\d+-\d+/.test(g.name)) && (guide.length === 8 || _test.isCupDay(today)), JSON.stringify(guide.slice(0, 2)));

      // One game on two channels is announced once. The relay isn't a sports channel at
      // all, so give a second channel the same slate item to be sure the dedupe is by game.
      _test.channelRuntime.set('reg-ch-twin', { channelId: 'reg-ch-twin', name: 'Twin TV', playlist: slate });
      const { on: onEvent, off: offEvent } = await import('../../server/engine/events.js');
      const seen = [];
      const hear = (g) => { if (String(g?.gameId || '').startsWith('reg-bc-')) seen.push(g.gameId); };
      onEvent('sports.game', hear);
      try {
        await _test.sportsHeartbeat();
        await _test.sportsHeartbeat();
      } finally {
        if (typeof offEvent === 'function') offEvent('sports.game', hear);
      }
      const playing = slate.some((i) => _test.slateHasGame(i.sportsScript, _test.sportsSlotIndex()));
      check('heartbeat: a game on two channels is announced once', playing ? seen.length === 1 : seen.length === 0, JSON.stringify(seen));
    } finally {
      for (const id of [...Object.keys(chans), 'reg-ch-twin']) _test.channelRuntime.delete(id);
    }
  }

  // ── News bulletin assembly ──────────────────────────────────────────────────
  // A news broadcast reads live stories and reads them out through anchor/reporter
  // NAME strings — no NPC. Feed synthetic stories and check the assembled graph: it
  // has spoken nodes, fills {tokens} (headline/anchor/reporter), and spawns no NPC.
  const newsScript = {
    anchors: ['Brick Hardline', 'Chastity Vale'],
    reporters: ['Ronnie Vasquez'],
    announcer: 'The Voice of Raptor',
    title: 'rnn_title',
    pools: {
      open: ['This is Raptor News.'],
      'anchor.intro': ["I'm {anchor}."],
      alert: ['BREAKING.'],
      'story.lead': ['Top story: {headline}.'],
      'handoff.reporter': ['Over to {reporter} in {scene}.'],
      'reporter.scene': ['{reporter} here: {body}'],
      'handoff.back': ['Back to you, {anchor}.'],
      'anchor.reaction': ['Unbelievable.'],
      'anchor.banter': ['{anchor2}, can you believe it?'],
      'rundown.lead': ['Also tonight:'],
      'rundown.item': ['Also: {headline}.'],
      outro: ["I'm {anchor}. Good night."],
      signoff: ['This has been Raptor News.'],
    },
  };
  const newsStories = [
    { headline: 'H1 Sentient Toaster', body: 'It filed paperwork.', byline: 'The Crier' },
    { headline: 'H2 Sinkhole Reclassified', body: 'A feature now.', byline: 'Static Weekly' },
    { headline: 'H3 Pigeon Elected', body: 'Most competent member.', byline: 'The Rust' },
    { headline: 'H4 Free Soylent', body: '', byline: 'x' },
  ];
  const ng = _test.assembleNewsGraph(newsScript, 'bc_news_regress', newsStories, 'bucket0');
  const sayTexts = Object.values(ng.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('news bulletin produces spoken lines', sayTexts.length >= 8, String(sayTexts.length));
  check('news fills the lead headline into a line', sayTexts.some(t => t.includes('H1 Sentient Toaster')), sayTexts[0] || '');
  check('news names an anchor from @anchor', sayTexts.some(t => t.includes('Brick Hardline')), 'anchor');
  check('news sends the lead story to a field reporter', sayTexts.some(t => t.includes('Ronnie Vasquez')), 'reporter');
  check('news leaves no unfilled {tokens}', !sayTexts.some(t => /\{\w+\}/.test(t)), sayTexts.find(t => /\{\w+\}/.test(t)) || 'clean');
  check('news title card leads the bulletin', Object.values(ng.nodes).some(n => n.type === 'title_card' && n.data?.graphic_id === 'rnn_title'), 'titlecard');
  check('newsFill strips unknown tokens to empty', _test.newsFill('a{nope}b', {}) === 'ab', _test.newsFill('a{nope}b', {}));

  // ── The bulletin's weather desk ─────────────────────────────────────────────
  // The weather segment is the one part of a newscast whose facts are REAL: it reads the
  // same live forecast DOOMCAST does. Two things have to hold. (1) A hero day is named as
  // ITSELF — an acid day picks wx.sky.acid, not the ordinary weather sitting underneath
  // it — because that line is the only warning a player who never opens the tablet gets.
  // (2) A news file with no wx.* pools loses nothing: the segment simply doesn't exist,
  // which is what makes the desk additive for any other news show.
  const wxEnv = {
    hour: 19, season: 'winter', feelsLikeC: -14,
    forecast: [
      { date: '2226-01-04', weatherType: 'rain', heroEvent: 'acid_rain', tempC: 6, windKph: 20, humidityPct: 80, precipChance: 0.8, severity: 0.9 },
      { date: '2226-01-05', weatherType: 'cloudy', tempC: 5, windKph: 10, humidityPct: 60, precipChance: 0.1, severity: 0.1 },
      { date: '2226-01-06', weatherType: 'snow', heroEvent: 'ion_storm', tempC: -3, windKph: 30, humidityPct: 70, precipChance: 0.5, severity: 0.8 },
    ],
  };
  const wxPools = {
    'wx.toss': ['Over to {meteorologist}.'],
    'wx.sky.acid': ['Acid, {precip}% of it.'],
    'wx.sky.ion': ['{day}: ion storm.'],
    'wx.warn.acid': ['⚠⚠ ACID WARNING for {day}.'],
    'wx.warn.ion': ['⚠⚠ ION STORM {day}.'],
    'wx.sky.snow': ['{day}: snow.'],
    'wx.trend.deteriorating': ['{severeCount} severe days, {worstDay} the worst.'],
    'wx.back': ['Back to you, {anchor}.'],
  };
  const wxScript = { ...newsScript, meteorologist: 'Skip Vandermeer', pools: { ...newsScript.pools, ...wxPools } };
  const wg = _test.assembleNewsGraph(wxScript, 'bc_news_wx', newsStories, 'bucket0', wxEnv);
  const wxTexts = Object.values(wg.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('news weather names the meteorologist', wxTexts.some(t => t.startsWith('Skip Vandermeer says')), 'meteorologist');
  check('news weather reads the live forecast', wxTexts.some(t => t.includes('Acid, 80% of it.')), wxTexts.join(' | ').slice(0, 200));
  check('an acid day is reported as acid, not as the rain underneath it',
    wxTexts.some(t => t.includes('ACID WARNING for today')), 'wx.warn.acid');
  check('a severe day later in the week is named ahead of time',
    wxTexts.some(t => t.includes('ION STORM')), 'wx.warn.ion');
  check('news weather leaves no unfilled {tokens}', !wxTexts.some(t => /\{\w+\}/.test(t)), wxTexts.find(t => /\{\w+\}/.test(t)) || 'clean');
  const noWx = _test.assembleNewsGraph(newsScript, 'bc_news_nowx', newsStories, 'bucket0', wxEnv);
  const noWxTexts = Object.values(noWx.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('a news file with no wx pools airs no weather segment',
    !noWxTexts.some(t => /Right now:|degrees|Skip Vandermeer/.test(t)), noWxTexts.find(t => /degrees/.test(t)) || 'clean');

  // ── DOOMCAST: the forecast is SPOKEN, so it is checked as speech ─────────────
  // The weather report had no coverage at all until now — the only thing that ever ran an
  // assembly was a player standing in front of a television, which is how a handover that
  // aired as its own line ("Tomorrow:" and then "tomorrow: rain at 40%.") and a 2am airing
  // opening on "Afternoon, survivors" both lived in the shipped show for months.
  const wxJoin = _test.wxJoinLead;
  check('a lead and its clause become ONE line', wxJoin('Tomorrow then', 'A 60% chance of rain.') === 'Tomorrow then, a 60% chance of rain.', wxJoin('Tomorrow then', 'A 60% chance of rain.'));
  check('the weld eats the lead\'s trailing punctuation', wxJoin('Tomorrow:', 'Rain.') === 'Tomorrow, rain.', wxJoin('Tomorrow:', 'Rain.'));
  check('a clause with no lead stands alone, capital intact', wxJoin(null, 'Rain.') === 'Rain.', wxJoin(null, 'Rain.'));
  check('an all-caps opener survives the weld', wxJoin('Then Friday', 'WX-9 says otherwise.') === 'Then Friday, WX-9 says otherwise.', wxJoin('Then Friday', 'WX-9 says otherwise.'));
  check('a leading {token} survives the weld', wxJoin('Then Friday', '{temp} degrees.') === 'Then Friday, {temp} degrees.', wxJoin('Then Friday', '{temp} degrees.'));
  // ⚠ The small hours are night. Without the `h < 5` arm they fall through to afternoon.
  check('2am is night, not afternoon', _test.wxTimeOfDayKey({ hour: 2 }) === 'night', _test.wxTimeOfDayKey({ hour: 2 }));
  check('midnight is night', _test.wxTimeOfDayKey({ hour: 0 }) === 'night', _test.wxTimeOfDayKey({ hour: 0 }));
  check('5am is morning', _test.wxTimeOfDayKey({ hour: 5 }) === 'morning', _test.wxTimeOfDayKey({ hour: 5 }));
  check('11pm is still night', _test.wxTimeOfDayKey({ hour: 23 }) === 'night', _test.wxTimeOfDayKey({ hour: 23 }));

  // Drive the real assembler over the real shipped pools, so the checks below are about
  // the show that airs rather than about a fixture written to pass them.
  // ⚠ The pools come from `content/`, not from the local DB. The DB is a dev database that
  // drifts from the tree (413 entities differed the day this was written), so a gate on it
  // would go red for anyone who hadn't run `content:import` and green for anyone whose DB
  // still held the version this is meant to catch. `content/` is what CODEX deploys.
  const wxDir = new URL('../../content/media_broadcasts/', import.meta.url);
  let wxScript2 = null;
  for (const f of readdirSync(wxDir)) {
    if (!f.endsWith('.json')) continue;
    const row = JSON.parse(readFileSync(new URL(f, wxDir), 'utf8'));
    if (row.weather_pools?.pools) { wxScript2 = row.weather_pools; break; }
  }
  if (wxScript2?.pools) {
    const fc = [
      { date: '2226-03-02', weatherType: 'rain', tempC: 6, windKph: 24, humidityPct: 62, precipChance: 0.6, severity: 0.1 },
      { date: '2226-03-03', weatherType: 'overcast', tempC: 5, windKph: 12, humidityPct: 60, precipChance: 0.1, severity: 0.1 },
      { date: '2226-03-04', weatherType: 'rain', tempC: 27, windKph: 12, humidityPct: 60, precipChance: 0.9, severity: 0.9, heroEvent: 'acid_rain' },
      { date: '2226-03-05', weatherType: 'fog', tempC: 4, windKph: 8, humidityPct: 92, precipChance: 0.1, severity: 0.1 },
    ];
    const wg2 = _test.assembleWeatherGraph(wxScript2.pools, wxScript2.host, fc, { hour: 2, season: 'spring', feelsLikeC: 4 }, 'bc_wx_regress', wxScript2.title);
    const wx2 = Object.values(wg2.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
    check('the forecast airs as spoken lines', wx2.length >= 8, String(wx2.length));
    check('the forecast leaves no unfilled {tokens}', !wx2.some(t => /\{\w+\}/.test(t)), wx2.find(t => /\{\w+\}/.test(t)) || 'clean');
    // The three artifacts of a teleprompter, checked on the assembled speech rather than
    // on the pools — a colon can be introduced by the assembler as easily as by an author.
    check('no spoken line reads a colon aloud', !wx2.some(t => t.includes(':')), wx2.find(t => t.includes(':')) || 'clean');
    check('no spoken line reads a glyph aloud', !wx2.some(t => /[⚠]/.test(t)), wx2.find(t => /⚠/.test(t)) || 'clean');
    check('no spoken line starts with a lowercase day label',
      !wx2.some(t => /^(today|tomorrow)\b/.test(t)), wx2.find(t => /^(today|tomorrow)\b/.test(t)) || 'clean');
    // The handover is welded on, so the day and its sky are one utterance, and a bare
    // transition never reaches air by itself.
    check('a handover is never a line of its own',
      !wx2.some(t => /^(Tomorrow|Then \w+|By \w+|Come \w+)[.,]?$/.test(t)), wx2.find(t => /^(Tomorrow|Then \w+|By \w+|Come \w+)[.,]?$/.test(t)) || 'clean');
    check('tomorrow is named in the same breath as its sky',
      wx2.some(t => /tomorrow, \w/i.test(t) || /^Tomorrow\b.*,/.test(t)), wx2.find(t => /tomorrow/i.test(t)) || 'none');
    check('precip is spoken as a chance, never as a quantity',
      !wx2.some(t => /%\s*of it/.test(t)), wx2.find(t => /%\s*of it/.test(t)) || 'clean');
    // A hero day is still reported as ITSELF, welded or not.
    check('an acid day is named as acid inside the welded line',
      wx2.some(t => /acid|caustic/i.test(t)), 'sky.acid');
    // ⚠ MEMBERSHIP IN THE POOL, never a regex over its prose. This enumerated
    // five phrasings against an `intro.night` pool that HAS five entries and
    // missed one of them — "Late one. Dex Rime. Sky's awake, so I am, so here we
    // are." — so the gate went red on roughly one run in five, at random, for a
    // show that had picked a perfectly good graveyard intro. Asserting membership
    // tests the thing the check is actually named for (the 2am slot drew from the
    // night pool) and cannot go stale the next time somebody adds a sixth line.
    // ⚠ The pool keys are FLAT DOTTED STRINGS — `pools['intro.night']`, not
    // `pools.intro.night`. `pools.intro` is a real key too (the daytime intros),
    // so the nested spelling silently reads `undefined` and fails every run
    // rather than one in five, which looks like a worse bug than the one it was
    // meant to fix.
    check('a 2am airing opens on the graveyard intro',
      (wxScript2.pools['intro.night'] || []).includes(wx2[0] || ''), wx2[0] || '(none)');
    check('the forecast still requires its host on stage', wg2._requireHost === true, String(wg2._requireHost));
  } else {
    check('a weather broadcast row exists to assemble', false, 'no weather_pools row');
  }

  // ── Talk-show episode assembly (live-acted, procedural) ──────────────────────
  // A talk show assembles a fresh episode from ::lines pools each night and ACTS it with
  // real cast NPCs. Check the assembled graph: it attributes lines to the cast (npc_anchor),
  // fills {host}/{guest}/{title}, is presence-gated (_requireHost), and anchors the guest's
  // answers to the reusable npc_guest.
  // DEV AID, off by default: TALKSHOW_DUMP=<day-bucket> prints one night of the REAL shipped
  // show to stdout, cast-attributed and with both gate branches expanded. The pools are the
  // thing a human reviews and there is no other way to read an episode without a browser, a
  // database and a television. Costs nothing when the env var is unset.
  if (process.env.TALKSHOW_DUMP) {
    const bucket = process.env.TALKSHOW_DUMP;
    const { rows } = await query(`SELECT talkshow_pools FROM media_broadcasts WHERE talkshow_pools IS NOT NULL LIMIT 1`);
    const s = rows[0]?.talkshow_pools;
    if (s) {
      const g = _test.assembleTalkshowGraph(s, 'bc_dump', bucket, _test.talkshowPersonaFor(s, bucket));
      const edge = (f, p) => g.edges.find(e => e.fromNode === f && e.fromPort === p)?.toNode;
      const walk = (at, d) => { let a = at, i = 0, cur = '?';
        while (a && i++ < 600) { const n = g.nodes[a];
          if (n.type === 'npc_anchor') cur = n.data?.npc_id || '(ambient)';
          else if (n.type === 'say') console.log('  '.repeat(d) + cur.padEnd(18) + ' | ' + (n.data?.text || ''));
          else if (n.type === 'condition') {
            console.log('  '.repeat(d) + `### GATE: is ${n.data?.params?.npc_id} in the studio?`);
            console.log('  '.repeat(d) + '--- YES ---'); walk(edge(a, 'ifTrue'), d + 1);
            console.log('  '.repeat(d) + '--- NO ---');  walk(edge(a, 'ifFalse'), d + 1);
            return;
          } else if (n.type !== 'start') console.log('  '.repeat(d) + `[${n.type}]`);
          a = edge(a, 'next'); } };
      console.log(`\n=== TALKSHOW DUMP (${bucket}) ===`);
      walk(g._start ?? Object.keys(g.nodes)[0], 0);
      console.log('=== END DUMP ===\n');
    }
  }

  const tsScript = {
    host: 'npc_john_akerson', sidekick: 'npc_graham_mercer', guestNpc: 'npc_guest',
    guests: [{ name: 'Testa Fixture', title: 'a lottery winner', theme: '' }, { name: 'Dr. Placeholder Quill', title: 'a mad surgeon', theme: '' }],
    title: 'tonight_show_logo', theme: 'tonight_theme',
    pools: {
      open: ["It's the show!"], tease: ['Tonight, chaos.'], announce_host: ['Here is {host}!'],
      monologue: ['Traffic was bad.', 'Crime is down.', 'Water is locked up.'],
      guest_intro: ['Welcome {guest}, {title}!'],
      interview: ['How are you, {guest}? >> Great, John.', 'Any regrets? >> None, John.'],
      commercial: ['Drink Acid Cola.'], signoff: ['Goodnight from {host}, thanks to {guest}.'],
      audience: ['( laughter )', '( groans )', '( applause )'], applause: ['( the crowd erupts )'],
    },
  };
  const persona = _test.talkshowPersonaFor(tsScript, 'day1');
  check('talkshow picks a persona from the guest pool', tsScript.guests.some(g => g.name === persona.name), persona.name);
  check('talkshow persona is deterministic per day bucket', _test.talkshowPersonaFor(tsScript, 'day1').name === persona.name, 'stable');
  const tg = _test.assembleTalkshowGraph(tsScript, 'bc_ts_regress', 'day1', persona);
  const tsSays = Object.values(tg.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('talkshow assembles spoken lines', tsSays.length >= 8, String(tsSays.length));
  check('talkshow is presence-gated (live-acted)', tg._requireHost === true, String(tg._requireHost));
  check('talkshow fills the guest persona into a line', tsSays.some(t => t.includes(persona.name)), tsSays.join(' | ').slice(0, 80));
  check('talkshow leaves no unfilled {tokens}', !tsSays.some(t => /\{\w+\}/.test(t)), tsSays.find(t => /\{\w+\}/.test(t)) || 'clean');
  check('talkshow anchors the guest\'s answers to npc_guest',
    Object.values(tg.nodes).some(n => n.type === 'npc_anchor' && n.data?.npc_id === 'npc_guest'), 'guest-anchored');
  check('talkshow leads with its title card',
    Object.values(tg.nodes).some(n => n.type === 'title_card' && n.data?.graphic_id === 'tonight_show_logo'), 'titlecard');
  // Audience reactions ride between the lines as ambient stage business (dim italic, no speaker,
  // not read aloud) — so the room breathes and each line lands before the next.
  check('talkshow drops audience reactions between lines',
    Object.values(tg.nodes).some(n => n.type === 'say' && n.data?.style === 'ambient'), 'has-crowd');

  // Sign-off is ONE line — the show never says goodnight twice. Use a pool of distinct
  // sign-offs and assert exactly one of them lands in the assembled episode.
  const soScript = { ...tsScript, pools: { ...tsScript.pools, signoff: ['GOODBYE-A', 'GOODBYE-B', 'GOODBYE-C'] } };
  const soSays = Object.values(_test.assembleTalkshowGraph(soScript, 'bc_so', 'day1', persona).nodes)
    .filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('talkshow says goodnight exactly once',
    soSays.filter(t => /^GOODBYE-[ABC]$/.test(t)).length === 1, soSays.filter(t => /^GOODBYE-/.test(t)).join(','));

  // The cold open is ONE line (each ends "It's the show!", so two aired the name twice), and a
  // list bit is read entry by entry, so its `||` separator never reaches the air.
  const olScript = { ...soScript, pools: { ...soScript.pools, open: ['OPEN-A', 'OPEN-B', 'OPEN-C'], list_bit: ['LIST || ONE || TWO'] } };
  const olEps = Array.from({ length: 24 }, (_, i) => Object.values(_test.assembleTalkshowGraph(olScript, 'bc_ol', `d${i}`, persona).nodes)
    .filter(n => n.type === 'say').map(n => n.data?.text || ''));
  check('talkshow cold open is one line, every night', olEps.every(s => s.filter(t => /^OPEN-/.test(t)).length === 1),
    olEps.map(s => s.filter(t => /^OPEN-/.test(t)).length).join(','));
  // A league player as the guest: his club's place and his own season come out of the tables.
  {
    const C = _test._standingsCaches, saved = new Map(C);
    C.set('hockey', { at: Date.now(), rows: [{ team: 'Coldwater Highlanders', wins: 9, losses: 4, otl: 1, points: 19 }, { team: 'Yard Birds', wins: 2, losses: 11, otl: 0, points: 4 }],
      extras: { players: { 'Sixfinger Dawes': { gp: 14, g: 7, a: 5 } }, goalies: { 'Plumb Bob Kasprzak': { gp: 13, w: 9, sa: 300, ga: 30 } }, toll: {}, career: {} } });
    C.set('baseball', { at: Date.now(), rows: [{ team: 'Coldwater Crows', wins: 20, losses: 10 }],
      extras: { ledger: { bats: new Map([['Okafor', { name: 'Okafor', team: 'Coldwater Crows', ab: 100, hits: 31, hr: 6, rbi: 22 }]]), arms: new Map([['Sato', { name: 'Sato', team: 'Coldwater Crows', w: 7, l: 3, outs: 270, er: 30, k: 80 }]]) } } });
    const picks = Array.from({ length: 64 }, (_, i) => _test.talkshowAthleteFor(i * 8)).filter(Boolean);
    const hockeyMen = picks.filter(p => p.athlete.sport === 'hockey'), ballMen = picks.filter(p => p.athlete.sport === 'baseball');
    check('talkshow books CPhL captains and goalies who live in the city', hockeyMen.length > 0 && hockeyMen.every(p => ['captain', 'goalie'].includes(p.athlete.role) && world.npcs.has(p.athlete.npcId)),
      hockeyMen.map(p => p.name).slice(0, 4).join(','));
    check('talkshow books a Deadball arm or bat with his numbers', ballMen.length > 0 && ballMen.every(p => /Sato|Okafor/.test(p.name) && /\d/.test(p.tok.season) && p.tok.club_rank === 'top of the table'),
      ballMen.map(p => `${p.name}: ${p.tok.season}`).slice(0, 2).join(' | '));
    C.clear(); for (const [k, v] of saved) C.set(k, v);
  }
  // A guest who lives in the city does the show themselves: no stand-in. Their name finds them,
  // the interview's answers are theirs, and their graph sends them to the studio.
  {
    const r = world.npcs.get('npc_barkeep');
    if (r) {
      const p = { name: r.name, title: 'who runs the Dead Pigeon', tag: 'barkeep' };
      check('talkshow finds the NPC a guest is named for', _test.talkshowRealGuest(p, 'npc_guest')?.id === r.id, String(_test.talkshowRealGuest(p, 'npc_guest')?.id));
      check('talkshow invents nobody for a made-up guest', _test.talkshowRealGuest({ name: 'Nobody Q. Nowhere' }, 'npc_guest') === null, 'null');
      const rs = { ...soScript, guests: [p] };
      const g = _test.assembleTalkshowGraph(rs, 'bc_real', 'd1', p);
      const anchors = Object.values(g.nodes).filter(n => n.type === 'npc_anchor').map(n => n.data?.npc_id);
      check('talkshow gives a real guest their own lines, not the stand-in', anchors.includes(r.id) && !anchors.includes('npc_guest'), anchors.join(','));
      const types = Object.values(_test.makeRealGuestGraph('zone_x').nodes).map(n => n.action_type).filter(Boolean);
      check('a called guest closes up, walks in, works the show and goes back', ['TALKSHOW_GUEST_LEAVE', 'GO_TO_WORK', 'AT_WORK', 'TALKSHOW_GUEST_DONE'].every(t => types.includes(t)), types.join(','));
    }
  }
  check('talkshow list bit airs entry by entry, no separator', olEps.some(s => s.includes('LIST') && s.includes('TWO')) && !olEps.flat().some(t => t.includes('||')), 'list');

  // Variety: different in-game days assemble materially different episodes (different jokes,
  // lengths, and structure — so it doesn't go stale). Use pools big enough to make a same-day
  // collision astronomically unlikely.
  const vScript = {
    host: 'npc_h', sidekick: 'npc_s', guestNpc: 'npc_guest',
    guests: [{ name: 'A', title: 't', theme: '', tag: '' }],
    pools: {
      open: ['o1', 'o2', 'o3', 'o4'], tease: ['t1', 't2', 't3', 't4', 't5'], announce_host: ['Here is {host}!'],
      monologue: Array.from({ length: 12 }, (_, i) => `joke ${i}`),
      guest_intro: ['Welcome {guest}!'],
      interview: Array.from({ length: 8 }, (_, i) => `q ${i}? >> a ${i}.`),
      sidekick_aside: ['aside a', 'aside b'], desk_bit: ['desk a', 'desk b'],
      commercial: ['ad a', 'ad b'], signoff: ['bye a', 'bye b', 'bye c'],
    },
  };
  const saysOf = (g) => Object.values(g.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  const epA = saysOf(_test.assembleTalkshowGraph(vScript, 'bc_v', 'day-A', _test.talkshowPersonaFor(vScript, 'day-A'))).join('|');
  const epB = saysOf(_test.assembleTalkshowGraph(vScript, 'bc_v', 'day-B', _test.talkshowPersonaFor(vScript, 'day-B'))).join('|');
  check('talkshow re-rolls a different episode each in-game day', epA !== epB, 'day-to-day variety');
  check('talkshow episode is stable within a day (all TVs agree)',
    saysOf(_test.assembleTalkshowGraph(vScript, 'bc_v', 'day-A', _test.talkshowPersonaFor(vScript, 'day-A'))).join('|') === epA, 'deterministic');

  // Persona identity: a guest with a signature exchange pool (interview.<tag>) gets their
  // own lines blended into the interview, so different guests give different interviews.
  const pScript = {
    ...vScript,
    guests: [{ name: 'Lucky', title: 'a winner', theme: '', tag: 'lucky' }],
    pools: { ...vScript.pools, 'interview.lucky': ['You won? >> SIGNATURE eight jackpots.', 'And? >> SIGNATURE only one wall leaks.'] },
  };
  const pSays = saysOf(_test.assembleTalkshowGraph(pScript, 'bc_p', 'dayX', _test.talkshowPersonaFor(pScript, 'dayX')));
  check('talkshow blends the guest\'s signature answers into the interview',
    pSays.some(t => t.includes('SIGNATURE')), pSays.find(t => t.includes('SIGNATURE')) || 'none');

  // Coherence: the guest's answer is the one authored WITH the host's question (a Q&A pair),
  // not an unrelated line index-matched from a separate pool.
  const cScript = { ...vScript, guests: [{ name: 'C', title: 't', theme: '', tag: '' }],
    pools: { ...vScript.pools, interview: ['MARKERQ the question? >> MARKERA the answer.'] } };
  const cSays = saysOf(_test.assembleTalkshowGraph(cScript, 'bc_c', 'dayC', _test.talkshowPersonaFor(cScript, 'dayC')));
  const qi = cSays.findIndex(t => t.includes('MARKERQ'));
  check('talkshow keeps each Q&A pair together (question then its own authored answer)',
    qi >= 0 && (cSays[qi + 1] || '').includes('MARKERA'), qi >= 0 ? (cSays[qi + 1] || 'nothing after') : 'no question');

  // ── The guest is dressed in memory, never in the table ──────────────────────
  // Which persona is on tonight is derived from the day bucket, and it used to be
  // written to `npcs`. That put derived state in a CONTENT table: the row drifted
  // from its file every night, and the next edit to that file made content:import
  // refuse to run, reading a rename nobody made by hand as an unexported local edit.
  {
    const { query } = await import('../../server/models/db.js');
    const { world } = await import('../../server/engine/world.js');
    const before = (await query("SELECT name, description FROM npcs WHERE id='npc_guest'")).rows[0];
    if (before) {
      await _test.talkshowHeartbeat();
      const after = (await query("SELECT name, description FROM npcs WHERE id='npc_guest'")).rows[0];
      check('the nightly guest rename never touches the npcs row',
        after.name === before.name && after.description === before.description,
        `${before.name} -> ${after.name}`);
      // The live object survives the pass with a usable name. Deliberately not
      // asserting that it CHANGED: whether the heartbeat has anything to dress
      // depends on a talk show being in a channel's live playlist, which this
      // fixture does not guarantee, and a check that passes for the wrong reason
      // is worse than no check. The dressing itself is proven by the show's own
      // graph tests above; what needed pinning here is that it stays out of the DB.
      const live = world.npcs.get('npc_guest');
      check('the live guest object survives the rename pass with a name',
        !!live && typeof live.name === 'string' && live.name.length > 0, live?.name);
      // The authored row is the shell between tapings, not last Tuesday's booking.
      check('the authored guest row is a placeholder, not a persona',
        /guest/i.test(before.name || ''), before.name);
    }
  }

  // ── Applause is addressed to somebody ───────────────────────────────────────
  // One flat applause deck, dealt in order, meant the swell behind "Ladies and
  // gentlemen, {host}!" could be a line naming the GUEST — who at that point has
  // not walked out and may still be crossing the city. Each entrance draws its own
  // subject pool first, so a named line can only play over the entrance it names.
  {
    const aScript = { ...tsScript, pools: { ...tsScript.pools,
      applause: ['( NEUTRAL swell )'],
      applause_host: ['( HOSTONLY {host} strolls out )'],
      applause_guest: ['( GUESTONLY {guest} takes the chair )'],
    } };
    const aSays = saysOf(_test.assembleTalkshowGraph(aScript, 'bc_ap', 'dayA', _test.talkshowPersonaFor(aScript, 'dayA')));
    const hostIn  = aSays.findIndex(t => t.includes('Here is '));        // announce_host
    const guestIn = aSays.findIndex(t => t.includes('Welcome '));        // guest_intro
    const nextAfter = (i, m) => aSays.slice(i + 1).find(t => /HOSTONLY|GUESTONLY|NEUTRAL/.test(t)) || m;
    check('the host entrance never draws a guest-named swell',
      !/GUESTONLY/.test(nextAfter(hostIn, '')), nextAfter(hostIn, 'nothing'));
    check('the guest entrance never draws a host-named swell',
      !/HOSTONLY/.test(nextAfter(guestIn, '')), nextAfter(guestIn, 'nothing'));
    // The neutral pool still has to be reachable, or the split has quietly turned
    // three subject lines into the entire applause vocabulary.
    check('the neutral applause pool is still in play', aSays.some(t => t.includes('NEUTRAL')), 'neutral reachable');
    // A show that authored no subject pools must behave exactly as it did before.
    const oldSays = saysOf(_test.assembleTalkshowGraph(tsScript, 'bc_ap2', 'dayA', _test.talkshowPersonaFor(tsScript, 'dayA')));
    check('a show with no subject pools still gets its applause',
      oldSays.some(t => t.includes('the crowd erupts')), 'fallback intact');
  }

  // ── The empty chair ─────────────────────────────────────────────────────────
  // The guest is the one cast member with a journey to make: it materialises backstage and
  // WALKS to the studio. It used to come on shift at airtime, so it was still en route through
  // the interview — and because the host and sidekick WERE on the floor, the "nobody home"
  // stand-by never fired and the say-node room-authority rule silently binned every answer.
  // What aired was John asking four questions of an empty chair. Two guards, both needed:
  // a call time so it arrives, and a gate so the show notices when it doesn't.
  {
    const gScript = { ...tsScript, pools: { ...tsScript.pools, guest_noshow: ['No guest, Graham? >> No guest, {host}.'] } };
    const gg = _test.assembleTalkshowGraph(gScript, 'bc_gate', 'day1', persona);
    // There are TWO presence gates now — the host gate up front and the chair gate before the
    // interview — so pick the one that names the guest rather than the first one found.
    const gates = Object.entries(gg.nodes).filter(([, n]) => n.type === 'condition' && n.data?.condition_type === 'NPC_IN_STUDIO');
    const gate = gates.find(([, n]) => n.data?.params?.npc_id === 'npc_guest');
    check('talkshow gates the interview on the guest being in the studio', !!gate, gate ? 'gated' : 'NO GATE — answers would be dropped silently');
    check('the chair gate names the guest NPC', gate?.[1]?.data?.params?.npc_id === 'npc_guest', gate?.[1]?.data?.params?.npc_id);

    // Both ports must lead somewhere and both must rejoin, or a night where the guest is late
    // strands the walker mid-show instead of reaching the sign-off.
    const edgeOf = (from, port) => gg.edges.find(e => e.fromNode === from && e.fromPort === port)?.toNode;
    const yes = edgeOf(gate?.[0], 'ifTrue'), no = edgeOf(gate?.[0], 'ifFalse');
    check('the chair gate wires both outcomes', !!yes && !!no && yes !== no, `ifTrue=${yes} ifFalse=${no}`);
    check('both outcomes land on real nodes', !!gg.nodes[yes] && !!gg.nodes[no], 'reachable');

    // Walk each branch to its end; both must arrive at the same sign-off, so the show ends once.
    const walkEnd = (from) => { let at = from, seen = 0; while (at && seen++ < 200) { const nx = edgeOf(at, 'next'); if (!nx) return at; at = nx; } return null; };
    check('guest-present and guest-absent branches rejoin (one sign-off, either way)',
      walkEnd(yes) && walkEnd(yes) === walkEnd(no), `${walkEnd(yes)} vs ${walkEnd(no)}`);
    const textOf = (from) => { const out = []; let at = from, seen = 0; while (at && seen++ < 200) { if (gg.nodes[at]?.type === 'say') out.push(gg.nodes[at].data?.text || ''); at = edgeOf(at, 'next'); } return out; };
    check('the no-show branch covers rather than airing silence', textOf(no).some(t => /No guest/.test(t)), textOf(no).slice(0, 2).join(' | '));
    // The absent-guest cover must never itself be spoken BY the absent guest.
    const noAnchors = (() => { const out = []; let at = no, seen = 0; while (at && seen++ < 200) { if (gg.nodes[at]?.type === 'npc_anchor') out.push(gg.nodes[at].data?.npc_id); at = edgeOf(at, 'next'); } return out; })();
    check('the no-show cover is never anchored to the missing guest', !noAnchors.includes('npc_guest'), noAnchors.join(','));
  }

  // ── The empty DESK ──────────────────────────────────────────────────────────
  // A missing guest is a segment. A missing HOST is not a show. The whole episode used to run
  // regardless — Graham did the open, fed the greeting into silence, introduced a guest to a
  // host who wasn't there to interview them, and read the goodnight, while the room-authority
  // rule binned John's every line underneath. It aired as the sidekick hosting. So the host
  // gets his own gate up front, and the false branch is short, solo, and ends the broadcast.
  {
    const hScript = { ...tsScript, pools: { ...tsScript.pools,
      host_absent: ['HE ISNT HERE.', 'I WONT DO HIS HALF.'], host_absent_signoff: ['GRAHAM-GOODNIGHT'] } };
    const hg = _test.assembleTalkshowGraph(hScript, 'bc_hostgate', 'day1', persona);
    const edgeOf = (from, port) => hg.edges.find(e => e.fromNode === from && e.fromPort === port)?.toNode;
    const hGate = Object.entries(hg.nodes).find(([, n]) =>
      n.type === 'condition' && n.data?.condition_type === 'NPC_IN_STUDIO' && n.data?.params?.npc_id === 'npc_john_akerson');
    check('talkshow gates the whole show on the HOST being in the studio', !!hGate,
      hGate ? 'gated' : 'NO HOST GATE — the sidekick would host it');

    const walk = (from) => { const out = []; let at = from, seen = 0, anchor = null;
      while (at && seen++ < 400) { const nd = hg.nodes[at];
        if (nd?.type === 'npc_anchor') anchor = nd.data?.npc_id;
        if (nd?.type === 'say') out.push({ by: anchor, text: nd.data?.text || '' });
        at = edgeOf(at, 'next'); } return out; };
    const absent = walk(edgeOf(hGate?.[0], 'ifFalse'));
    const present = walk(edgeOf(hGate?.[0], 'ifTrue'));
    check('the host-absent branch tells the audience rather than faking the show',
      absent.some(l => l.text === 'HE ISNT HERE.'), absent.map(l => l.text).slice(0, 2).join(' | '));
    // Everything the announcer cannot do without the host, he does not do.
    check('the host-absent branch runs no monologue and no guest intro',
      !absent.some(l => /Traffic was bad|Crime is down|Water is locked up|Welcome /.test(l.text)),
      absent.map(l => l.text).join(' | ').slice(0, 90));
    check('the host-absent branch never reads the show\'s own sign-off',
      !absent.some(l => /Goodnight from/.test(l.text)) && absent.some(l => l.text === 'GRAHAM-GOODNIGHT'),
      absent.map(l => l.text).slice(-1).join(''));
    check('nobody speaks for the missing host', !absent.some(l => l.by === 'npc_john_akerson'),
      [...new Set(absent.map(l => l.by))].join(','));
    // …and with the host present, nothing about the normal show changed. `walk` follows `next`
    // and so stops at the chair gate — the greeting, the monologue and the guest intro are all
    // ahead of it, which is exactly the stretch this asserts on.
    check('the host-present branch runs the host\'s own monologue and guest intro',
      present.some(l => l.by === 'npc_john_akerson')
        && present.some(l => /Traffic was bad|Crime is down|Water is locked up/.test(l.text))
        && present.some(l => /^Welcome /.test(l.text)),
      present.map(l => l.text).join(' | ').slice(0, 90));

    // SEGMENT DISCIPLINE. The announcer belongs in the intro, the monologue and the goodnight —
    // never inside the interview. He used to be sprinkled through the whole hour, which reads
    // as a co-host rather than a sidekick.
    const iGate = Object.entries(hg.nodes).find(([, n]) =>
      n.type === 'condition' && n.data?.condition_type === 'NPC_IN_STUDIO' && n.data?.params?.npc_id === 'npc_guest');
    const interviewLines = walk(edgeOf(iGate?.[0], 'ifTrue'));
    check('the show still reaches the host\'s sign-off past the chair gate',
      interviewLines.some(l => /Goodnight from/.test(l.text) && l.by === 'npc_john_akerson'),
      interviewLines.map(l => l.text).slice(-2).join(' | '));
    // Walk only as far as the commercial — past it is the goodnight segment, where he's allowed.
    const adAt = interviewLines.findIndex(l => l.text === 'Drink Acid Cola.');
    const seg = adAt < 0 ? interviewLines : interviewLines.slice(0, adAt);
    check('the sidekick never talks over the interview',
      !seg.some(l => l.by === 'npc_graham_mercer'), seg.filter(l => l.by === 'npc_graham_mercer').map(l => l.text).join(' | ') || 'clean');
  }

  // First names. Two men who have shared a desk for nineteen years do not call each other by
  // their full names across it, and the script used to hardcode "John" into the text — right on
  // air, wrong the moment the host NPC is renamed. `{host}` stays the marquee name for the
  // announcer's formal introduction; `{host_first}` is what the conversation uses.
  {
    const nScript = { ...tsScript, pools: { ...tsScript.pools,
      announce_host: ['Ladies and gentlemen, {host}!'],
      greeting: ['Evening, {sidekick_first}. >> Evening, {host_first}.'] } };
    const nSays = saysOf(_test.assembleTalkshowGraph(nScript, 'bc_names', 'day1', persona));
    check('the formal introduction uses the host\'s full name',
      nSays.some(t => t === 'Ladies and gentlemen, John Akerson!'), nSays.find(t => /Ladies and gentlemen/.test(t)) || 'missing');
    check('the desk conversation uses first names',
      nSays.some(t => t === 'Evening, John.') && nSays.some(t => t === 'Evening, Graham.'),
      nSays.filter(t => /Evening/.test(t)).join(' | ') || 'none');
  }

  // Call time: the guest is on shift a slot EARLY (and nobody else is), which is the half of
  // the fix that means the gate almost never has to fire.
  check('the guest gets a call time (on shift the slot before airtime)',
    _test.talkshowAiring({ airSlots: [(_test.sportsSlotIndex() % _test.SPORTS_GAMES_PER_DAY + 1) % _test.SPORTS_GAMES_PER_DAY] }, _test.TALKSHOW_GUEST_CALL_LEAD) === true, 'called early');
  check('the rest of the cast is NOT called early (no lead ⇒ airtime only)',
    _test.talkshowAiring({ airSlots: [(_test.sportsSlotIndex() % _test.SPORTS_GAMES_PER_DAY + 1) % _test.SPORTS_GAMES_PER_DAY] }, 0) === false, 'airtime only');

  // ── …and a going-home time ──────────────────────────────────────────────────
  // The slot reserves a whole in-game 3-hour block and the episode replays inside it,
  // so an episode is routinely still on air when the block ticks over. There was a
  // lead-in and no lag-out, so the flip walked the ENTIRE cast off the set mid-show
  // and the studio, now empty, told viewers nobody had arrived yet.
  {
    const G = _test.SPORTS_GAMES_PER_DAY;
    const now = _test.sportsSlotIndex() % G;
    const prev = { airSlots: [(now - 1 + G) % G] };   // aired last block, not this one
    const far  = { airSlots: [(now + 3) % G] };       // nowhere near
    // A generous tail stands in for "an episode could still be running".
    check('the cast is held past the end of their slot while an episode may still be running',
      _test.talkshowAiring(prev, 0, 9999) === true, 'held over');
    check('the hold-over only applies to a slot that just aired',
      _test.talkshowAiring(far, 0, 9999) === false, 'not held');
    // Zero tail is the old behaviour, and must still be off the moment the slot ends —
    // otherwise the grace is really just a second airing slot.
    check('with no tail the cast goes off shift the instant the slot flips',
      _test.talkshowAiring(prev, 0, 0) === false, 'clean flip');
  }

  // ── Not asking the same question twice ──────────────────────────────────────
  // "What would you tell young people considering your line of work?" and "Did you always know
  // this was your calling?" are one question in two costumes. Drawing both made the show look
  // like it wasn't listening, so a [topic] tag is a promise that only one of a group airs.
  {
    const tagged = ['[career] A >> a', '[career] B >> b', '[career] C >> c', '[money] D >> d', '[sleep] E >> e'];
    const got = _test.topicPick(tagged, 5, () => 0.5);
    const topics = got.map(l => /^\[([\w-]+)\]/.exec(l)[1]);
    check('a topic can only be asked once per episode', new Set(topics).size === topics.length, topics.join(','));
    check('topic dedupe still fills the episode from other topics', got.length === 3, String(got.length));
    check('untagged lines are unconstrained', _test.topicPick(['x', 'y', 'z'], 3, () => 0.5).length === 3, 'free');
    check('the [topic] tag never reaches the air',
      !_test.talkshowDraw({ p: ['[career] the line'] }, 'p', 1, {}, () => 0.5)[0].includes('['), _test.talkshowDraw({ p: ['[career] the line'] }, 'p', 1, {}, () => 0.5)[0]);
  }

  // ── John and Graham ─────────────────────────────────────────────────────────
  // A two-hander is authored as ONE line of alternating turns, so the setup, the reply and the
  // topper can't be dealt apart. More than two turns is the whole point — a real desk exchange
  // runs "…?" / "…" / "…?" / "…" — and splitting on only the first `>>` would air the rest as
  // one line with a literal `>>` in it.
  check('a two-hander splits into every turn, not just the first',
    _test.splitTurns('one >> two >> three >> four').length === 4, _test.splitTurns('one >> two >> three').join(' / '));
  {
    const bScript = { ...tsScript, pools: { ...tsScript.pools,
      banter: ['GRAHAM1 >> JOHN1 >> GRAHAM2'], greeting: ['JOHNG >> GRAHAMG'] } };
    // Assemble a few nights: the banter beat is probabilistic, so assert over a spread.
    let sawAlternating = false;
    for (const day of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
      const g = _test.assembleTalkshowGraph(bScript, 'bc_b', day, persona);
      const seq = [];
      let anchorNow = null;
      for (const n of Object.values(g.nodes)) {
        if (n.type === 'npc_anchor') anchorNow = n.data?.npc_id;
        else if (n.type === 'say' && /^(GRAHAM|JOHN)/.test(n.data?.text || '')) seq.push([anchorNow, n.data.text]);
      }
      const i = seq.findIndex(([, t]) => t === 'GRAHAM1');
      if (i >= 0 && seq[i][0] === 'npc_graham_mercer'
          && seq[i + 1]?.[1] === 'JOHN1' && seq[i + 1][0] === 'npc_john_akerson'
          && seq[i + 2]?.[1] === 'GRAHAM2' && seq[i + 2][0] === 'npc_graham_mercer') sawAlternating = true;
    }
    check('banter alternates announcer and host across every turn', sawAlternating, 'three-turn exchange staged correctly');
  }
  // The runtime already wraps a line as `<name> says, "…"`, so an authored "{sidekick}: " prefix
  // aired Graham's name twice. Nothing in a pool should carry its own speaker.
  check('no assembled line carries its own speaker prefix',
    !tsSays.some(t => /^(John Akerson|Graham Mercer|\{host\}|\{sidekick\}):/.test(t)),
    tsSays.find(t => /^(John Akerson|Graham Mercer):/.test(t)) || 'clean');

  // Auto-lock scheduling: saving a talk show pins it to a DAILY slot at its @airtime block
  // on its channel and flips the channel to daily mode — so it airs at its broadcast time
  // with zero manual scheduling.
  {
    const TCH = 'ch_ts_autolock_rx', TBC = 'bc_ts_autolock_rx';
    await query('DELETE FROM media_channel_playlist WHERE channel_id=$1', [TCH]);
    await query('DELETE FROM media_channels WHERE id=$1', [TCH]);
    await query('DELETE FROM media_broadcasts WHERE id=$1', [TBC]);
    await query("INSERT INTO media_channels (id,name,number) VALUES ($1,'TS Autolock Rx',9917)", [TCH]);
    await query("INSERT INTO media_broadcasts (id,name,playback_mode) VALUES ($1,'TS Autolock Rx','talkshow')", [TBC]);
    await _test.ensureTalkshowSlot(TBC, TCH, { airSlots: [7] });
    const { rows: slotRows } = await query('SELECT start_time, duration_override FROM media_channel_playlist WHERE channel_id=$1 AND broadcast_id=$2', [TCH, TBC]);
    check('talkshow auto-pins one daily slot at its airtime block', slotRows.length === 1 && Number(slotRows[0].start_time) === 7 * 3 * 3600, JSON.stringify(slotRows));
    const { rows: chRows } = await query('SELECT schedule_mode FROM media_channels WHERE id=$1', [TCH]);
    check('talkshow flips its channel to daily schedule', chRows[0]?.schedule_mode === 'daily', chRows[0]?.schedule_mode);
    // re-pinning is idempotent (no duplicate slot piles up on re-save)
    await _test.ensureTalkshowSlot(TBC, TCH, { airSlots: [7] });
    const { rows: again } = await query('SELECT id FROM media_channel_playlist WHERE channel_id=$1 AND broadcast_id=$2', [TCH, TBC]);
    check('talkshow re-pin stays a single slot (idempotent)', again.length === 1, String(again.length));
    await query('DELETE FROM media_channel_playlist WHERE channel_id=$1', [TCH]);
    await query('DELETE FROM media_channels WHERE id=$1', [TCH]);
    await query('DELETE FROM media_broadcasts WHERE id=$1', [TBC]);
  }
  // ── Game shows (live-acted, catalog-sourced, audience-participating) ─────────
  // A game show deals its questions from the LIVE item catalog and is played out on the
  // studio floor. The properties that matter: every TV must see the same lots (determinism),
  // the lots must be answerable (priced, distinct, sanely bounded), a round must score
  // correctly, resolving must never pay twice, and a viewer who tunes in mid-episode must
  // never see `undefined` on air.
  {
    const gsScript = {
      host: 'npc_gs_host', sidekick: 'npc_gs_side',
      contestants: ['Renna Voss', 'Dex-4', 'Marguerite Okonkwo-Bell'],
      pools: {
        open: ['This is THE LAST LOT.'],
        announce_host: ['Here he is — {host}!'],
        audience_call: ['Anyone on my floor can play — {verb} a number.'],
        'round_intro.overunder': ['Higher or lower.'],
        'round_intro.price': ['Closest without going over.'],
        'round_intro.lot': ['Order them.'],
        showcase_intro: ['THE SHOWCASE.'],
        prize_copy: ['Tonight: {prize}.'],
        prompt: ["What's it worth?"],
        stall: ['Take your time.'],
        reveal: ['The floor said {guesses}. The card says {price}.'],
        'reveal.lot': ['{guesses}. It goes {order}.'],
        showcase_reveal: ['The lot comes to {price}. Bids were {guesses}.'],
        verdict_read: ['{verdict} That is {purse} credits.'],
        audience: ['The audience makes a noise.'],
        applause: ['Applause.'],
        commercial: ['Sponsored by ACID COLA.'],
        signoff: ["That's the last lot."],
        ticker: ['Sold as seen. No returns.'],
      },
    };
    const normalize = _test.normalizeGraph;
    const roundsOf = (g) => Object.values(g.nodes).filter(n => n.type === 'gameshow_round').map(n => n.data);
    const saysOfG = (g) => Object.values(g.nodes).filter(n => n.type === 'say').map(n => n.data.text);

    const g1 = _test.assembleGameshowGraph(gsScript, 'bc_gs_rx', 'day1', normalize);
    const g2 = _test.assembleGameshowGraph(gsScript, 'bc_gs_rx', 'day1', normalize);
    check('gameshow: same day bucket → byte-identical episode',
      JSON.stringify(g1.nodes) === JSON.stringify(g2.nodes), 'episode diverged across two assembles');
    const g3 = _test.assembleGameshowGraph(gsScript, 'bc_gs_rx', 'day2', normalize);
    check('gameshow: a new day bucket deals a different episode',
      JSON.stringify(g3.nodes) !== JSON.stringify(g1.nodes), 'two days produced the same show');
    // The block is longer than the show, so the walker replays it — and a replay of the
    // SAME lots hands out the answers to anyone who sat through one pass.
    const gp1 = _test.assembleGameshowGraph(gsScript, 'bc_gs_rx', 'day1', normalize, undefined, 1);
    check('gameshow: the second pass of a block deals a different episode',
      JSON.stringify(gp1.nodes) !== JSON.stringify(g1.nodes), 'the replay repeated the same lots');
    check('gameshow: a pass re-deal keeps the day _broadcastId (no mid-block seek)',
      gp1._broadcastId === g1._broadcastId, `${gp1._broadcastId} vs ${g1._broadcastId}`);
    check('gameshow: the episode ends on a pass-bump node',
      Object.values(g1.nodes).some(n => n.type === 'gameshow_endpass'), 'no gameshow_endpass node');
    check('gameshow: the pass counter rolls and resets with the day',
      _test.gameshowPassIndex('ch_gs_pass', 'day1') === 0
      && (_test.gameshowEndPass('ch_gs_pass'), _test.gameshowPassIndex('ch_gs_pass') > 0)
      && _test.gameshowPassIndex('ch_gs_pass', 'a_brand_new_day') === 0,
      "pass counter didn't roll or didn't reset");

    check('gameshow: the episode is presence-gated', g1._requireHost === true, String(g1._requireHost));
    check('gameshow: the episode reaches a spoken line', saysOfG(g1).length > 0, String(saysOfG(g1).length));
    check('gameshow: every round is paired with a reveal',
      roundsOf(g1).length === Object.values(g1.nodes).filter(n => n.type === 'gameshow_reveal').length,
      `${roundsOf(g1).length} rounds`);

    // Every lot must be answerable: priced inside the sane band, described, and never a drug.
    const T = _test.gameshowTest;
    const pool = _test.gameshowPool();
    check('gameshow: the prize pool is non-empty', pool.length > 0, String(pool.length));
    check('gameshow: every prize is inside the price band',
      pool.every(p => p.value >= T.PRIZE_MIN_VALUE && p.value <= T.PRIZE_MAX_VALUE),
      'a prize fell outside the band');
    check('gameshow: no drugs or raw chemicals are given away on air',
      pool.every(p => p.type !== 'drug' && p.type !== 'chemical'), 'contraband on the plinth');
    check('gameshow: no prize name appears twice',
      new Set(pool.map(p => p.name.toLowerCase())).size === pool.length, 'duplicate lot names');

    // Round shape per format. The ordering round is the one that can silently become
    // unanswerable — two lots at the same price have no correct order.
    for (const r of roundsOf(g1)) {
      check(`gameshow: ${r.format} round has its lots`, r.prizes.length > 0, JSON.stringify(r.prizes));
      if (r.format === 'lot') {
        check('gameshow: the ordering round has three DISTINCTLY priced lots',
          r.prizes.length === 3 && new Set(r.prizes.map(p => p.value)).size === 3,
          JSON.stringify(r.prizes.map(p => p.value)));
      }
      if (r.format === 'overunder') {
        const [x, y] = r.prizes.map(p => p.value);
        check('gameshow: over-or-under is never a coin flip',
          Math.max(x, y) / Math.min(x, y) >= T.OVERUNDER_MIN_RATIO, `${x} vs ${y}`);
      }
      if (r.format === 'showcase') check('gameshow: the showcase grants the actual lot', r.grantsItem === true, String(r.grantsItem));
    }

    // Airing gate — same convention as sports/talkshow.
    check('gameshow: no @airtime ⇒ airs continuously', _test.gameshowAiring({}, 3) === true, 'gated with no airSlots');
    check('gameshow: an out-of-range slot set is dark now', _test.gameshowAiring({ airSlots: [-1] }, 3) === false, 'aired off-slot');
    check('gameshow: airs in its own slot', _test.gameshowAiring({ airSlots: [3] }, 3) === true, 'missed its slot');

    // Scoring. Entries are insertion-ordered, so a tie goes to whoever answered first.
    const en = (name, value) => ({ key: name, name, value, label: String(value) });
    check('gameshow: closest without going over picks the highest under',
      _test.scorePrice([en('a', 30), en('b', 50), en('c', 45)], 55)?.name === 'b', 'wrong winner');
    check('gameshow: an over-bid is eliminated',
      _test.scorePrice([en('a', 60), en('b', 50)], 55)?.name === 'b', 'an over-bid won');
    check('gameshow: everyone over ⇒ nobody wins',
      _test.scorePrice([en('a', 60), en('b', 99)], 55) === null, 'somebody won while over');
    check('gameshow: a price tie goes to whoever bid first',
      _test.scorePrice([en('a', 50), en('b', 50)], 55)?.name === 'a', 'tie broke the wrong way');
    check('gameshow: over-or-under, first correct answer takes it',
      _test.scoreOverUnder([en('a', 'lower'), en('b', 'higher')], 'higher')?.name === 'b', 'wrong direction winner');
    check('gameshow: over-or-under with nobody right ⇒ nobody wins',
      _test.scoreOverUnder([en('a', 'lower')], 'higher') === null, 'a wrong answer won');
    const ORDER = [2, 3, 1];
    check('gameshow: the exact order wins the lot round',
      _test.scoreLot([en('a', [2, 3, 1]), en('b', [1, 2, 3])], ORDER)?.name === 'a', 'exact order lost');
    check('gameshow: a closer order beats a worse one',
      _test.scoreLot([en('a', [2, 1, 3]), en('b', [1, 3, 2])], ORDER)?.name === 'a', 'worse order won');
    check('gameshow: a shared best score ⇒ nobody wins the lot round',
      _test.scoreLot([en('a', [3, 1, 2]), en('b', [1, 2, 3])], ORDER) === null, 'a tie paid out');
    check('gameshow: the showcase band is inclusive at both edges',
      _test.scoreShowcase([en('a', 800)], 1000)?.name === 'a' && _test.scoreShowcase([en('b', 1200)], 1000)?.name === 'b',
      'a boundary bid was rejected');
    check('gameshow: a bid outside the showcase band loses',
      _test.scoreShowcase([en('a', 799)], 1000) === null && _test.scoreShowcase([en('b', 1201)], 1000) === null,
      'an out-of-band bid won');

    // Answer parsing — one verb, four formats.
    check('gameshow: a plain number parses', _test.parseGuess('price', ['400'])?.value === 400, 'number rejected');
    check('gameshow: commas and credit signs are tolerated',
      _test.parseGuess('price', ['4,800'])?.value === 4800 && _test.parseGuess('price', ['₵55'])?.value === 55, 'formatting rejected');
    check('gameshow: junk and zero are rejected',
      _test.parseGuess('price', ['banana']) === null && _test.parseGuess('price', ['0']) === null, 'junk accepted');
    check('gameshow: higher/lower synonyms parse',
      _test.parseGuess('overunder', ['over'])?.value === 'higher' && _test.parseGuess('overunder', ['l'])?.value === 'lower', 'synonym rejected');
    check('gameshow: an ordering answer needs three distinct slots',
      JSON.stringify(_test.parseGuess('lot', ['2', '1', '3'])?.value) === '[2,1,3]'
      && _test.parseGuess('lot', ['1', '1', '2']) === null
      && _test.parseGuess('lot', ['1', '2']) === null, 'bad permutation accepted');

    // ── Subjects ──────────────────────────────────────────────────────────
    // The seam that lets one game-show engine run two different programmes. The rule
    // that matters most is the fallback: every show that existed before subjects did
    // is a retail show and must keep behaving like one.
    const retail = _test.getGameshowSubject('retail');
    const basin = _test.getGameshowSubject('basin');
    check('gameshow: both subjects are registered',
      _test.gameshowSubjectIds().includes('retail') && _test.gameshowSubjectIds().includes('basin'),
      _test.gameshowSubjectIds().join(','));
    check('gameshow: an absent subject falls back to retail',
      _test.getGameshowSubject('').id === 'retail' && _test.getGameshowSubject(undefined).id === 'retail', 'no fallback');
    check('gameshow: an UNKNOWN subject falls back to retail rather than throwing',
      _test.getGameshowSubject('no_such_subject_at_all').id === 'retail', "unknown subject didn't fall back");
    check('gameshow: a subject id is matched case-insensitively',
      _test.getGameshowSubject('BASIN').id === 'basin', 'case-sensitive lookup');
    check('gameshow: every subject declares a plan of at most four rounds',
      [retail, basin].every(s => Array.isArray(s.plan) && s.plan.length && s.plan.length <= 4),
      [retail, basin].map(s => `${s.id}:${s.plan?.length}`).join(' '));

    // The basin subject: a letter, and only a letter.
    check('gameshow: a bare letter parses as a choice',
      basin.parse('choice', ['b'])?.value === 'b' && basin.parse('choice', ['D'])?.value === 'd', 'letter rejected');
    check('gameshow: a letter is found inside a spoken answer',
      basin.parse('choice', ['b,', 'the', 'ashway'])?.value === 'b', 'embedded letter missed');
    check('gameshow: a letter outside the option range is rejected',
      basin.parse('choice', ['z']) === null && basin.parse('choice', ['400']) === null, 'out-of-range letter accepted');
    check('gameshow: an empty choice answer is rejected', basin.parse('choice', []) === null, 'empty accepted');
    check('gameshow: the choice hint names the verb shape',
      /guess\s+b/i.test(basin.hint('choice')), basin.hint('choice'));
    check('gameshow: a choice is scored right-or-wrong, first in',
      basin.score('choice', [{ key: 'a', value: 'c' }, { key: 'b', value: 'b' }], { correct: 'b' })?.key === 'b'
      && basin.score('choice', [{ key: 'a', value: 'c' }], { correct: 'b' }) === null, 'choice scoring wrong');
    check('gameshow: a choice tie goes to whoever answered first',
      basin.score('choice', [{ key: 'first', value: 'b' }, { key: 'second', value: 'b' }], { correct: 'b' })?.key === 'first',
      "tie didn't go to the first answer");

    // The material. These pools are the whole reason the subject is affordable — they
    // read the boot-loaded registries and nothing else.
    const T2 = _test.gameshowTest;
    const districts = T2.districtPool();
    const orders = T2.orderPool();
    check('gameshow: the basin subject has districts to ask about', districts.length >= 3, String(districts.length));
    check('gameshow: every district question has authored copy behind it',
      districts.every(d => d.name && String(d.blurb).trim()), 'a district reached the pool with no blurb');
    check("gameshow: only NPC orders are quotable — a player corp isn't general knowledge",
      orders.every(o => o.name && String(o.creed).trim()), 'an order reached the pool with no creed');
    check('gameshow: the material pools are sorted, so an episode is reproducible',
      districts.every((d, i) => i === 0 || districts[i - 1].id <= d.id), "district pool isn't id-sorted");

    // THE defect this subject would otherwise ship with: the authored copy was written to
    // be read ABOUT a place, so it very often names it, and a verbatim quote answers its
    // own question. Sweeping the whole corpus is the only check worth having here.
    const leaks = [
      ...districts.map(d => [d.name, T2.redactAnswer(T2.speakable(d.blurb), d.name)]),
      ...orders.map(o => [o.name, T2.redactAnswer(T2.speakable(o.creed), o.name)]),
    ].filter(([name, q]) => q.toLowerCase().includes(String(name).replace(/^the\s+/i, '').toLowerCase()));
    check('gameshow: no quoted question names its own answer',
      leaks.length === 0, leaks.map(([n]) => n).join(', '));
    check('gameshow: redaction masks a multi-word name as one bar, not several',
      (T2.redactAnswer('deep in the Commercial Strip somewhere', 'the Commercial Strip').match(/————/g) || []).length === 1,
      T2.redactAnswer('deep in the Commercial Strip somewhere', 'the Commercial Strip'));
    check('gameshow: redaction leaves short common words alone',
      T2.redactAnswer('the end of the road', 'the Docks') === 'the end of the road',
      T2.redactAnswer('the end of the road', 'the Docks'));

    // A whole basin episode, assembled the same way the runtime does it.
    const basinScript = { ...gsScript, subject: 'basin' };
    const gb = _test.assembleGameshowGraph(basinScript, 'bc_gs_basin', 'day1', normalize);
    const basinRounds = Object.values(gb.nodes).filter(n => n.type === 'gameshow_round').map(n => n.data);
    check('gameshow: a basin episode deals rounds', basinRounds.length > 0, String(basinRounds.length));
    check('gameshow: every basin round is a choice tagged with its subject',
      basinRounds.every(r => r.format === 'choice' && r.subject === 'basin'),
      basinRounds.map(r => `${r.format}/${r.subject}`).join(' '));
    check('gameshow: every basin round has a correct letter inside its own options',
      basinRounds.every(r => T2.CHOICE_LETTERS.includes(r.correct)),
      basinRounds.map(r => r.correct).join(','));
    // A quiz has no lot on a plinth, and granting a random item as a consolation would put
    // untraceable loot on the floor.
    check('gameshow: a basin round never hands over an item',
      basinRounds.every(r => !r.grantsItem && (!r.prizes || !r.prizes.length)), 'a quiz round granted a lot');
    check('gameshow: the basin finale still pays the showcase purse',
      basinRounds[basinRounds.length - 1]?.purse === _test.gameshowTest.SHOWCASE_PRIZE,
      String(basinRounds[basinRounds.length - 1]?.purse));
    check('gameshow: a basin episode is reproducible from its seed',
      JSON.stringify(_test.assembleGameshowGraph(basinScript, 'bc_gs_basin', 'day1', normalize).nodes) === JSON.stringify(gb.nodes),
      'basin episode diverged across two assembles');
    // A retail round carries no `subject` when it was dealt before subjects existed; the
    // runtime must read that as retail rather than as a missing subject.
    check('gameshow: a retail round is tagged retail',
      roundsOf(g1).every(r => r.subject === 'retail'), roundsOf(g1).map(r => r.subject).join(','));

    // Round lifecycle with no player in the studio — the show must play out regardless.
    _test.gameshowOpenRound('ch_gs_rx', {
      format: 'price', roundIndex: 0, price: 100, purse: 40,
      prizes: [{ id: 'item_rx', name: 'a thing', value: 100 }],
      npcGuesses: [{ name: 'Renna Voss', value: 90, label: '90' }, { name: 'Dex-4', value: 400, label: '400' }],
    }, '__no_such_studio__');
    const res1 = _test.gameshowResolveRound('ch_gs_rx');
    check('gameshow: with an empty studio a stranger still wins', res1.winner?.name === 'Renna Voss', JSON.stringify(res1.winner));
    check('gameshow: an NPC win pays nobody', res1.paid === 0, String(res1.paid));
    const res2 = _test.gameshowResolveRound('ch_gs_rx');
    check('gameshow: resolving twice scores once (never double-pays)', res2 === res1, 'a second resolve produced a new result');
    const tok = _test.gameshowTokens('ch_gs_rx');
    check('gameshow: the winner token names the winner', tok.winner === 'Renna Voss', tok.winner);
    check('gameshow: the guesses token lists the floor',
      tok.guesses.includes('Renna Voss 90') && tok.guesses.includes('Dex-4 400'), tok.guesses);

    // A guess from someone who has since left the studio is forfeit — presence is
    // re-checked at resolve, not at guess time.
    _test.gameshowOpenRound('ch_gs_rx2', {
      format: 'price', price: 100, purse: 40, prizes: [{ id: 'i', name: 'x', value: 100 }], npcGuesses: [],
    }, '__no_such_studio__');
    _test.gameshowTest.rounds.get('ch_gs_rx2').guesses.set('p_absent', { name: 'Ghost', value: 99, label: '99' });
    const res3 = _test.gameshowResolveRound('ch_gs_rx2');
    check('gameshow: a bidder who left the studio forfeits', res3.winner === null && res3.walkedOff === 1, JSON.stringify(res3.winner));

    // The late-tuner case: _seekGraph walks past the round nodes without firing them, so a
    // reveal line can air with no round behind it. It must read as prose, never `undefined`.
    const bare = _test.gameshowTokens('__channel_that_never_aired__');
    check('gameshow: off-round tokens are all strings',
      ['guesses', 'contestant', 'guess', 'winner', 'verdict'].every(k => typeof bare[k] === 'string'), JSON.stringify(bare));
    check('gameshow: off-round tokens never leak undefined',
      !Object.values(bare).some(v => v === undefined || String(v).includes('undefined')), JSON.stringify(bare));
    // …and the same must hold through the real airtime substitution path.
    const subbed = _test.subTokens('The floor said {guesses}. {verdict}', '__channel_that_never_aired__', {}, {});
    check('gameshow: a reveal line off-round substitutes cleanly',
      !subbed.includes('undefined') && !subbed.includes('{guesses}'), subbed);

    // The title card reads the purses BEFORE a lot has been shown, so the money tokens must
    // resolve with no round in play — and must never carry a price (that would be the answer).
    check('gameshow: the money tokens resolve off-round',
      ['purse_round', 'purse_showcase', 'paid_today'].every(k => typeof bare[k] === 'string' && /\d/.test(bare[k])),
      JSON.stringify(bare));
    const card = _test.subTokens('TOP PURSE ₵ {purse_showcase} / PAID ₵{paid_today}', '__channel_that_never_aired__', {}, {});
    check('gameshow: the title card money line substitutes for real',
      !card.includes('{') && card.includes(String(_test.gameshowTest.SHOWCASE_PRIZE)), card);

    _test.gameshowTest.rounds.delete('ch_gs_rx');
    _test.gameshowTest.rounds.delete('ch_gs_rx2');
    _test.gameshowTest.lastResults.delete('ch_gs_rx');
    _test.gameshowTest.lastResults.delete('ch_gs_rx2');
  }

  // The `guess` verb is inert everywhere except a studio with a live round — it must never
  // do anything in an ordinary room.
  {
    const out = await run('guess 400');
    check('guess is inert outside a studio', /nothing to guess at/i.test(String(out || '')), String(out).slice(0, 120));
  }

  // ── Morning-show assembly (live-acted, world-sourced) ────────────────────────
  // A morning show assembles today's episode from the LIVE world — clock, forecast, news
  // feed, standing alerts — and acts it on the couch. Check that each live channel actually
  // reaches a spoken line, that the couch trades (host line → co-host line), and that the
  // run-in picks the worst standing alert rather than the first one it finds.
  const mnScript = {
    host: 'npc_am_pace', cohost: 'npc_am_dorn', title: 'coldwater_am_logo', theme: 'coldwater_am_theme',
    pools: {
      open: ['It is {time} and it is {temp} degrees. >> Statistically.'],
      'weather.rain': ['Rain, {temp} degrees. >> Of course it is.'],
      'weather.ahead': ['Tomorrow: {tomorrow}, {tomorrowTemp}. >> Something to dread.'],
      'beat.banner': ['THE BASIN BEAT | STORIES FROM YOUR STREET'],
      'beat.lead': ['First up — {headline}! >> And there it is.'],
      'runin.blackout': ["{outages} blocks are dark. >> Don't trust the stairwell."],
      'runin.clear': ['Clean run-in today. >> Enjoy it.'],
      'ticker.lead': ['COLDWATER A.M.'],
      signoff: ["That's us. >> Same sunrise."],
      credits: ['LINE ONE', 'LINE TWO'],
    },
  };
  const mnCtx = (over = {}) => ({
    env: {
      time: '06:00', date: '2231-03-04', dayOfWeek: 'Tuesday', season: 'winter',
      tempC: 4, feelsLikeC: -2, currentWeatherType: 'rain',
      forecast: [{ tempC: 4, windKph: 12, precipChance: 0.8, severity: 0.1, weatherType: 'rain' },
                 { tempC: 6, weatherType: 'overcast' }],
      powerMap: [],
    },
    stories: [{ headline: 'Redline Man Reunited With A Dog', body: 'Not the dog.', byline: 'The Crier' },
              { headline: 'Vat Intake Within Normal Range', body: '', byline: 'Civic Wire' },
              { headline: 'TICKER ONLY STORY', body: '', byline: 'x' }],
    outages: 0, martialLaw: false, radiation: false, ...over,
  });
  const mg = _test.assembleMorningGraph(mnScript, 'bc_mn_regress', 'day1', mnCtx());
  const mnNodes = Object.values(mg.nodes);
  const mnSays = mnNodes.filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('morning show assembles spoken lines', mnSays.length >= 6, String(mnSays.length));
  check('morning show is presence-gated (live-acted)', mg._requireHost === true, String(mg._requireHost));
  check('morning show reads the live clock and thermometer',
    mnSays.some(t => t.includes('06:00') && t.includes('4 degrees')), mnSays[0] || '');
  check('morning show picks the weather pool matching the live sky',
    mnSays.some(t => t.startsWith('Rain, 4 degrees')), mnSays.join(' | ').slice(0, 90));
  check('morning show reads the live news feed into the Basin Beat',
    mnSays.some(t => t.includes('Redline Man Reunited With A Dog')), 'basin-beat');
  check('morning show leaves no unfilled {tokens}', !mnSays.some(t => /\{\w+\}/.test(t)), mnSays.find(t => /\{\w+\}/.test(t)) || 'clean');
  // The couch trades: every authored pair puts the setup on the host and the reply on the co-host.
  const openIdx = mnNodes.findIndex(n => n.type === 'say' && (n.data?.text || '').includes('06:00'));
  const anchorBefore = (i) => { for (let k = i; k >= 0; k--) if (mnNodes[k].type === 'npc_anchor') return mnNodes[k].data?.npc_id; return null; };
  check('morning show puts the setup on the host and the deadpan on the co-host',
    anchorBefore(openIdx) === 'npc_am_pace' && anchorBefore(openIdx + 1) === 'npc_am_dorn',
    `${anchorBefore(openIdx)} → ${anchorBefore(openIdx + 1)}`);
  // The ticker is assembled from facts, not authored: conditions + the headlines that
  // didn't make the couch.
  const mnTicker = mnNodes.find(n => n.type === 'ticker')?.data?.text || '';
  check('morning ticker carries live conditions', /RAIN · 4° \(feels -2°\)/.test(mnTicker), mnTicker.slice(0, 60));
  check('morning ticker carries the headlines that missed the couch', mnTicker.includes('TICKER ONLY STORY'), mnTicker.slice(-60));
  check('morning credits keep every card (joined, not picked)',
    (mnNodes.find(n => n.type === 'credits')?.data?.text || '') === 'LINE ONE\nLINE TWO', 'credits');
  // The run-in reads the city: alerts outrank an ordinary morning, worst-first.
  check('morning run-in: an ordinary day is clear', _test.morningRunInKey(mnCtx()) === 'clear', _test.morningRunInKey(mnCtx()));
  check('morning run-in: grid faults beat a clear morning', _test.morningRunInKey(mnCtx({ outages: 3 })) === 'blackout', 'blackout');
  check('morning run-in: martial law outranks everything',
    _test.morningRunInKey(mnCtx({ outages: 9, radiation: true, martialLaw: true })) === 'martial_law', 'martial_law');
  const mgDark = _test.assembleMorningGraph(mnScript, 'bc_mn_regress', 'day1', mnCtx({ outages: 4 }));
  const darkSays = Object.values(mgDark.nodes).filter(n => n.type === 'say').map(n => n.data?.text || '');
  check('morning run-in speaks the live outage count', darkSays.some(t => t.startsWith('4 blocks are dark')), 'outages');
  // Same day ⇒ same show on every TV; a new day ⇒ a new one.
  check('morning show is stable within a day (all TVs agree)',
    Object.values(_test.assembleMorningGraph(mnScript, 'bc_mn_regress', 'day1', mnCtx()).nodes)
      .filter(n => n.type === 'say').map(n => n.data?.text || '').join('|') === mnSays.join('|'), 'deterministic');

  check('talkshowAiring: no @airtime airs continuously',
    _test.talkshowAiring({}) === true && _test.talkshowAiring({ airSlots: [] }) === true, 'continuous');
  check('talkshowAiring: an out-of-range slot is dark now', _test.talkshowAiring({ airSlots: [-1] }) === false, 'dark');

  // The guest's lifecycle graph wires the roaming behaviour: schedule branch → appear +
  // commute onstage; off-shift → hide.
  const gg = _test.makeTalkshowGuestGraph('zone_studio');
  const ggTypes = Object.values(gg.nodes).map(n => n.action_type || n.condition_type).filter(Boolean);
  check('guest graph gates on the broadcast schedule', ggTypes.includes('IS_BROADCAST_SCHEDULED'), ggTypes.join(','));
  check('guest graph wires appear → commute → hold → hide',
    ['TALKSHOW_APPEAR', 'GO_TO_WORK', 'AT_WORK', 'TALKSHOW_HIDE'].every(a => ggTypes.includes(a)), ggTypes.join(','));

  const { conditions, actions } = getRegisteredAINodes();
  check('AI condition nodes registered',
    ['CHANNEL_HAS_VIEWERS', 'IS_BROADCAST_SCHEDULED', 'AT_WORK_ZONE'].every(c => conditions.includes(c)),
    conditions.join(','));
  check('AI action node registered', actions.includes('BROADCAST_SAY'), actions.join(','));

  // ── Off-shift studio actor leaves the studio building ────────────────────────
  // Synthetic two-zone building: an interior stage (its own map) whose `out`
  // exit leads to an exterior world tile. A studio actor with no live slot
  // (isNpcScheduledNow → false for an unknown npc) should walk out of the stage
  // on its next HAVE_LIFE tick rather than lingering.
  const EXT = 'zt_bc_ext', STAGE = 'zt_bc_stage', MAP = 'map_bc_test';
  const mkZone = (id, map_id, flags, exits) => ({
    id, name: id, map_id, flags, exits,
    npcs: new Set(), players: new Set(), enemies: new Set(),
  });
  world.zones.set(EXT, mkZone(EXT, 'map_world', {}, { in: STAGE }));
  world.zones.set(STAGE, mkZone(STAGE, MAP,
    { is_interior: true, is_building: true, world_exit_zone: EXT }, { out: EXT }));

  const actor = {
    id: 'npc_bc_test_actor', name: 'Test Actor',
    zone_id: STAGE, studio_zone_id: STAGE,
    behaviour_graph: {
      _start: 'n_start',
      nodes: {
        n_start: { type: 'start', next: 'n_life' },
        n_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'n_start' },
      },
    },
    _ai: initBlackboard(),
  };
  world.zones.get(STAGE).npcs.add(actor.id);

  const ctx = { broadcast: () => {}, query: () => ({ catch: () => {} }) };
  try {
    check('actor starts inside the studio building', actor.zone_id === STAGE, actor.zone_id);
    // One HAVE_LIFE tick = one step; the stage's `out` leads straight outside.
    let ticks = 0;
    while (actor.zone_id !== EXT && ticks++ < 5) {
      await tickEntityAI(actor, ctx);
    }
    check('off-shift actor walked out of the studio building', actor.zone_id === EXT, actor.zone_id);
  } finally {
    world.zones.get(STAGE)?.npcs.delete(actor.id);
    world.zones.delete(STAGE);
    world.zones.delete(EXT);
  }

  // ── Talk-show guest: appears in the world, then vanishes when unobserved ──────
  // A 4-zone rig: an interior studio whose `out` leads to a chain of two exterior tiles,
  // plus an exit-less backstage limbo. The guest lives in limbo. TALKSHOW_APPEAR should
  // teleport it out to a public, unobserved tile a couple of steps from the studio (never
  // the on-stage tile, never inside the building); TALKSHOW_HIDE, run where nobody/no camera
  // is watching, should send it straight back to limbo.
  const GSTUDIO = 'zt_ts_studio', GE1 = 'zt_ts_ext1', GE2 = 'zt_ts_ext2', GLIMBO = 'zt_ts_limbo', GMAP = 'map_ts_test';
  world.zones.set(GSTUDIO, mkZone(GSTUDIO, GMAP, { is_interior: true, is_building: true, world_exit_zone: GE1 }, { out: GE1 }));
  world.zones.set(GE1, mkZone(GE1, 'map_world', {}, { in: GSTUDIO, out: GE2 }));
  world.zones.set(GE2, mkZone(GE2, 'map_world', {}, { in: GE1 }));
  world.zones.set(GLIMBO, mkZone(GLIMBO, null, { hidden_backstage: true, no_spawn: true }, {}));

  const guest = {
    id: 'npc_ts_test_guest', name: "Tonight's Guest",
    zone_id: GLIMBO, home_zone: GLIMBO, work_zone_id: GSTUDIO, studio_zone_id: GSTUDIO,
    behaviour_graph: {
      _start: 'q_start',
      nodes: {
        q_start:  { type: 'start', next: 'q_appear' },
        q_appear: { type: 'action', action_type: 'TALKSHOW_APPEAR', next: 'q_idle' },
        q_idle:   { type: 'action', action_type: 'IDLE', next: 'q_start' },
      },
    },
    _ai: initBlackboard(),
  };
  world.zones.get(GLIMBO).npcs.add(guest.id);
  try {
    check('guest starts hidden backstage', guest.zone_id === GLIMBO, guest.zone_id);
    await tickEntityAI(guest, ctx);
    check('guest APPEARS out on a public tile, not on-stage/backstage',
      guest.zone_id !== GLIMBO && guest.zone_id !== GSTUDIO && world.zones.get(guest.zone_id)?.map_id === 'map_world', guest.zone_id);

    // Now off-shift, standing on an unobserved tile: HIDE should vanish it to backstage.
    guest.zone_id = GE2;
    world.zones.get(GE1)?.npcs.delete(guest.id);
    world.zones.get(GE2).npcs.add(guest.id);
    guest._ai = initBlackboard();
    guest.behaviour_graph = {
      _start: 'h_start',
      nodes: {
        h_start: { type: 'start', next: 'h_hide' },
        h_hide:  { type: 'action', action_type: 'TALKSHOW_HIDE', next: 'h_idle' },
        h_idle:  { type: 'action', action_type: 'IDLE', next: 'h_start' },
      },
    };
    await tickEntityAI(guest, ctx);
    check('guest VANISHES to backstage once unobserved', guest.zone_id === GLIMBO, guest.zone_id);
  } finally {
    for (const z of [GSTUDIO, GE1, GE2, GLIMBO]) { world.zones.get(z)?.npcs.delete(guest.id); world.zones.delete(z); }
  }

  // ── Chips unify with cassettes: a clip becomes a loadable mini-cassette ──────
  const BC_ID = 'bc_clip_regress';
  await query('DELETE FROM media_broadcasts WHERE id=$1', [BC_ID]);
  await ensureClipBroadcast(BC_ID, 'Footage: Regress Alley', [{ text: 'Kaz arrives.', kind: 'event' }, { text: 'Kaz says, "clear"', kind: 'say' }], 4);
  const { rows: bc } = await query('SELECT playback_mode, enabled, category, message_interval, jsonb_array_length(messages) AS n, broadcast_graph FROM media_broadcasts WHERE id=$1', [BC_ID]);
  check('ensureClipBroadcast makes a hidden scripted broadcast', bc[0] && bc[0].playback_mode === 'scripted' && bc[0].enabled === 0 && bc[0].n === 2, JSON.stringify(bc[0]));
  check('clip broadcast is categorized surveillance (drives the MicroReel visual)', bc[0]?.category === 'surveillance', bc[0]?.category);
  // The reel is imported as a real broadcast graph (say-node chain), so it airs
  // like a broadcast — dialogue frames as leak-able 'verbatim' speech, narrated
  // action/arrival frames as plain lines.
  const clipGraph = typeof bc[0]?.broadcast_graph === 'string' ? JSON.parse(bc[0].broadcast_graph) : bc[0]?.broadcast_graph;
  const clipNodes = clipGraph?.nodes || {};
  check('clip import builds a broadcast graph (start → linked say chain)',
    clipGraph?._start === 'start' && clipNodes.start?.next === 'clip_0'
      && clipNodes.clip_0?.type === 'say' && clipNodes.clip_0?.next === 'clip_1' && clipNodes.clip_1?.next == null,
    JSON.stringify(clipGraph)?.slice(0, 220));
  check('dialogue frame → verbatim (airs as captured + leaks as [TV] speech); action frame → raw',
    clipNodes.clip_0?.style === 'raw' && clipNodes.clip_1?.style === 'verbatim'
      && clipNodes.clip_0?.text === 'Kaz arrives.' && clipNodes.clip_1?.text === 'Kaz says, "clear"',
    `clip_0=${clipNodes.clip_0?.style} clip_1=${clipNodes.clip_1?.style}`);
  await ensureClipBroadcast(BC_ID, 'Footage: Regress Alley', [{ text: 'only one now' }], 4); // idempotent upsert
  const { rows: bc2 } = await query('SELECT jsonb_array_length(messages) AS n FROM media_broadcasts WHERE id=$1', [BC_ID]);
  check('ensureClipBroadcast upserts in place (no duplicate rows)', bc2.length === 1 && bc2[0].n === 1, JSON.stringify(bc2));
  await query('DELETE FROM media_broadcasts WHERE id=$1', [BC_ID]);

  // `load chip …` routes to the cassette loader (a chip is a mini-cassette), not
  // through to another handler — with nothing carried it reports cleanly.
  const lc = await run('load chip');
  check('load chip routes to the cassette loader', lc?.type === 'output' && /no cassette to load/i.test(lc?.message || ''), JSON.stringify(lc));

  // ── Broadcast piracy ─────────────────────────────────────────────────────────
  // The crime registry ships the takeover heat, self-reporting (a citywide hijack
  // announces itself the moment it airs).
  check('broadcast_piracy crime is registered with heat', getCrimeStars('broadcast_piracy') > 0, String(getCrimeStars('broadcast_piracy')));
  check('broadcast_piracy self-reports (witness always)', getCrimeWitness('broadcast_piracy') === 'always', getCrimeWitness('broadcast_piracy'));

  // The deck-operate gate: admin/dev (station-owner proxy) or the current pirate
  // may operate; everyone else is locked out with the right hint.
  const { canOperateDeck, deckLockError } = _piracyTest;
  check('an admin can operate any deck', canOperateDeck({}, { id: 'p1', role: 'admin' }) === true, 'admin');
  check('the current pirate can operate their seized deck', canOperateDeck({ pirate_owner: 'p1' }, { id: 'p1', role: 'player' }) === true, 'pirate-owner');
  check("a stranger can't operate an un-seized deck", canOperateDeck({}, { id: 'p2', role: 'player' }) === false, 'stranger');
  // A consumer deck is an appliance, not a transmitter: whoever is in the room works
  // it. Without this a resident can't put a tape in their own machine, and the
  // SPECTER cam patch (which reuses the same gate) would be unreachable.
  check('anyone present can operate a consumer deck', canOperateDeck({ mini_deck: true }, { id: 'p2', role: 'player' }) === true, 'mini-deck');
  check('a consumer deck stays operable even while pirated by someone else',
    canOperateDeck({ mini_deck: true, pirate_owner: 'p1' }, { id: 'p2', role: 'player' }) === true, 'mini-deck+pirate');
  check('a stranger can\'t operate someone else\'s seized deck', canOperateDeck({ pirate_owner: 'p1' }, { id: 'p2', role: 'player' }) === false, 'rival');
  check('lock error hints to pirate an un-seized deck', /pirate/i.test(deckLockError({}, { id: 'p2', role: 'player' })?.message || ''), 'hint');
  check('an operator gets no lock error', deckLockError({ pirate_owner: 'p1' }, { id: 'p1', role: 'player' }) === null, 'no-error');

  // `pirate` is gated TWICE, and the order matters: the firmware first (it's the
  // thing you have to go and get), then a carried `hack_device` like every other
  // breach in the game. The firmware check fires first here because the fake player
  // has neither — so this also pins the ordering, and a regression that dropped the
  // firmware gate would surface as a device error instead of this one.
  const pir = await run('pirate');
  check('pirate is gated on the firmware', pir?.type === 'error' && /firmware/i.test(pir?.message || ''), JSON.stringify(pir));

  // `pirateresolve` with no armed token is a silent no-op (anti-spoof).
  const pr = await run('pirateresolve deck_none 1');
  check('pirateresolve without an armed hijack no-ops', pr?.type === 'noop', JSON.stringify(pr));

  // ── Pirate console (Phase 2) ─────────────────────────────────────────────────
  // Queue loop semantics (pure): 'queue' wraps, 'off' stops at the end, 'item' holds.
  const { nextCursor } = _piracyTest;
  check('loop queue advances mid-queue', nextCursor(0, 3, 'queue').cursor === 1 && !nextCursor(0, 3, 'queue').stop, JSON.stringify(nextCursor(0, 3, 'queue')));
  check('loop queue wraps at the end', nextCursor(2, 3, 'queue').cursor === 0 && !nextCursor(2, 3, 'queue').stop, JSON.stringify(nextCursor(2, 3, 'queue')));
  check('loop off stops at the end', nextCursor(2, 3, 'off').stop === true && nextCursor(2, 3, 'off').cursor === 2, JSON.stringify(nextCursor(2, 3, 'off')));
  check('loop off advances before the end', nextCursor(0, 3, 'off').cursor === 1 && !nextCursor(0, 3, 'off').stop, JSON.stringify(nextCursor(0, 3, 'off')));
  check('loop item holds the same slot', nextCursor(1, 3, 'item').cursor === 1 && !nextCursor(1, 3, 'item').stop, JSON.stringify(nextCursor(1, 3, 'item')));
  check('empty queue stops', nextCursor(0, 0, 'queue').stop === true, JSON.stringify(nextCursor(0, 0, 'queue')));

  // `air` is refused when you hold no station (the console is gated on a seizure).
  const air = await run('air');
  check('air with no seized station is refused', air?.type === 'error' && /station/i.test(air?.message || ''), JSON.stringify(air));
  const airPlay = await run('air play');
  check('air play with no seized station is refused', airPlay?.type === 'error' && /station/i.test(airPlay?.message || ''), JSON.stringify(airPlay));

  // ── Live camera routing (Phase 3) ────────────────────────────────────────────
  // The live/recorded subcommands route through cmdAir and gate on holding a
  // station (they don't throw or fall through to the usage error).
  const airLive = await run('air live');
  check('air live routes + gates on a seizure', airLive?.type === 'error' && /station/i.test(airLive?.message || ''), JSON.stringify(airLive));
  const airSrc = await run('air source station');
  check('air source routes + gates on a seizure', airSrc?.type === 'error' && /station/i.test(airSrc?.message || ''), JSON.stringify(airSrc));

  // ── Reclaim: engineer response timing (Phase 4) ──────────────────────────────
  // The engineer arrives a fixed defend window (120 s) after the seizure; a repel
  // stamps an explicit next-attempt time that then wins.
  const { engineerDueAt } = _piracyTest;
  check('engineer is due one defend window after seizure', engineerDueAt({ pirate_since: 1000 }) === 1000 + 120000, String(engineerDueAt({ pirate_since: 1000 })));
  check('a stamped retry time overrides the default window', engineerDueAt({ pirate_since: 1000, pirate_engineer_at: 5000 }) === 5000, String(engineerDueAt({ pirate_since: 1000, pirate_engineer_at: 5000 })));

  // ── Counter-hack: the rival takes the deck, not the last captor's crawl ─────────
  // The crawl is player-typed and the console renders it. A crawl that survived a
  // seizure landed in the rival's console, which is how a stored payload in it
  // reached a second player. The queue still carries over.
  const { seizeDeckFlags } = _piracyTest;
  const seized = seizeDeckFlags({
    pirate_owner: 'p_first', pirate_since: 1, pirate_crawl: 'x" onmouseover="alert(1)', pirate_queue: [{ id: 'bc_a' }], pirate_engineer_at: 9,
  }, 'p_rival', 5000);
  check('a counter-hack hands the deck to the rival', seized.pirate_owner === 'p_rival' && seized.pirate_since === 5000, JSON.stringify(seized));
  check('a counter-hack drops the last captor\'s crawl', !('pirate_crawl' in seized), JSON.stringify(seized.pirate_crawl));
  check('a counter-hack keeps the queue and opens a fresh defend window',
    seized.pirate_queue?.[0]?.id === 'bc_a' && !('pirate_engineer_at' in seized), JSON.stringify(seized));

  // ── Emergency broadcast override (the Echelon's special MediaDeck) ────────────
  // Verbs are admin-gated; the fake player is a plain 'player'.
  let r = await run('airemergency');
  check('airemergency refused for non-admin', r?.type === 'error' && /administrators/i.test(r.message || ''), r?.message);
  r = await run('endemergency');
  check('endemergency refused for non-admin', r?.type === 'error' && /administrators/i.test(r.message || ''), r?.message);

  // Exported takeover API: real broadcast engages, unknown id refused, clear releases.
  check('emergency inactive at rest', emergencyActive() === false);
  const start = await startEmergency('bc_echelon_emergency');
  check('startEmergency engages a real bulletin', start?.ok === true && emergencyActive() === true, JSON.stringify(start));
  const bad = await startEmergency('bc_does_not_exist');
  check('startEmergency refuses an unknown bulletin', bad?.ok === false);
  const stop = stopEmergency();
  check('stopEmergency releases the airwaves', stop?.wasActive === true && emergencyActive() === false, JSON.stringify(stop));

  // ── The Emergency Broadcast System console ───────────────────────────────────
  // The console is a skin over `ebs` sub-verbs, so everything below drives the real
  // verbs through the real dispatcher. The fake player is a plain 'player' and the
  // whole surface is admin-gated, so the role is borrowed and handed straight back.
  {
    const EBZONE = 'zone_echelon_broadcast';
    const player = getPlayer();
    const savedZone = player.current_zone;
    const savedRole = player.role;

    const ebsDenied = await run('ebs');
    check('ebs: refused for a non-admin', ebsDenied?.type === 'error' && /administrators/i.test(ebsDenied.message || ''), JSON.stringify(ebsDenied));

    player.role = 'admin';
    try {
      const nowhere = await run('ebs');
      check('ebs: says so in a room with no console',
        nowhere?.type === 'error' && /no emergency broadcast console/i.test(nowhere.message || ''), JSON.stringify(nowhere));

      player.current_zone = EBZONE;
      // ⚠ Re-read the row every time: updateFurniture re-caches the RETURNING row and
      // REPLACES the object in world.furniture, so a reference held from before a
      // command is a stale copy asserting against the old flags.
      const deckNow = () => (getZoneFurniture(EBZONE) || []).find(f => f?.flags && 'emergency_deck' in f.flags);
      const authored = structuredClone(deckNow()?.flags || {});
      check('ebs: the Echelon console is real content, not a fixture', !!deckNow(), 'no emergency_deck furniture in ' + EBZONE);

      // The cameras are content too — a console with no camera can never air a live
      // address, and the whole live half would pass vacuously.
      const cams = _test.emergencyCameras(deckNow());
      check('ebs: the studio has cameras on the floor', cams.length >= 2, JSON.stringify(cams.map(c => c.label)));
      check('ebs: a camera authored with flags.camera_label wears that name',
        cams.some(c => /rostrum/i.test(c.label)), JSON.stringify(cams.map(c => c.label)));

      const open = await run('ebs');
      check('ebs: opens the console', open?.type === 'emergency_console', JSON.stringify(open?.type));
      check('ebs: the console starts off air', open?.on === false, JSON.stringify(open?.on));
      check('ebs: and reports the authored source', open?.mode === 'cassette' && !!open?.activeCassetteId, JSON.stringify({ mode: open?.mode, tape: open?.activeCassetteId }));

      // ── Ticker ────────────────────────────────────────────────────────────────
      const tk = await run('ebs ticker STAY INDOORS. THIS IS NOT A DRILL.');
      // ⚠ CASE. The dispatcher builds `args` off `raw.toLowerCase()`, so a crawl read
      // from there goes out over every screen in the city in lower case. The mixed-case
      // fixture is the assertion, not decoration.
      check('ebs ticker: the text is stored on the console, in the case it was typed', deckNow()?.flags?.eb_ticker === 'STAY INDOORS. THIS IS NOT A DRILL.', JSON.stringify(deckNow()?.flags?.eb_ticker));
      check('ebs ticker: and the console reads it back', tk?.ticker === 'STAY INDOORS. THIS IS NOT A DRILL.', JSON.stringify(tk?.ticker));
      const longTicker = 'x'.repeat(_test.EB_TICKER_MAX + 80);
      await run(`ebs ticker ${longTicker}`);
      check('ebs ticker: a long crawl is clamped, never rejected',
        (deckNow()?.flags?.eb_ticker || '').length === _test.EB_TICKER_MAX, String((deckNow()?.flags?.eb_ticker || '').length));
      await run('ebs ticker STAY INDOORS. THIS IS NOT A DRILL.');

      // ── The switch ────────────────────────────────────────────────────────────
      check('ebs: nothing is on air before the switch is thrown', emergencyActive() === false);
      const onCassette = await run('ebs on');
      check('ebs on: the system takes the air', emergencyActive() === true && onCassette?.on === true, JSON.stringify(onCassette?.on));
      const stC = emergencyStatus();
      check('ebs on: carrying the loaded bulletin', stC?.mode === 'cassette' && stC?.broadcastId === authored.deck_active, JSON.stringify(stC));
      check('ebs on: and carrying the ticker with it', stC?.ticker === 'STAY INDOORS. THIS IS NOT A DRILL.', JSON.stringify(stC?.ticker));

      // ── THE TICKER RIDES ONE SLOT IN THREE ────────────────────────────────────
      // Arithmetic, and the only way to see it is to ask for the beat at a known
      // millisecond: a ticker that took every slot would replace the bulletin rather
      // than scroll under it, and a ticker that took none would look like a feature
      // that was never wired up. Both draw a plausible picture on a live set.
      {
        const fake = { channelId: 'ch_test_eb', currentFallbackMessages: [] };
        const styles = [];
        for (let slot = 0; slot < 9; slot++) {
          const m = _test.emergencyMessage(fake, slot * 5000);
          styles.push(m?.style === 'ticker' ? 'T' : (m ? '.' : '-'));
        }
        check('ebs ticker: rides exactly one five-second slot in three',
          styles.filter(s => s === 'T').length === 3, styles.join(''));
        check('ebs ticker: and never two in a row', !styles.join('').includes('TT'), styles.join(''));
      }

      // ── THE SEIZED AIR MUST NOT FLICKER TO STATIC ─────────────────────────────
      // The tick runs at 1s and every beat here lasts longer than that: a bulletin
      // line holds for its six-second interval, a ticker or a camera cut for its
      // five-second slot. A REPEATED KEY is treated by the tick exactly as no content
      // at all — `wasActive` goes false and the off-air static card is pushed — so
      // emitting a beat on all of its ticks showed content for one second and static
      // for the rest. Measured before the fix: 5 lines and 5 off-air cards over 20
      // seconds. This replays the tick's own dedup rule against the real beats.
      {
        const fake = { channelId: 'ch_test_eb_flicker', currentFallbackMessages: [] };
        let lastKey = null, wasActive = false, offAir = 0, lines = 0;
        for (let t = 0; t < 20; t++) {
          const m = _test.emergencyMessage(fake, t * 1000);
          if (!m || m.key === lastKey) { if (wasActive) { offAir++; wasActive = false; } continue; }
          wasActive = true; lastKey = m.key;
          if (m.style !== 'live_relay') lines++;
        }
        check('ebs: the seized air never drops to the off-air card between beats', offAir === 0, `${offAir} off-air transition(s) in 20 ticks`);
        check('ebs: ...while still putting real content out', lines >= 4, `${lines} line(s) in 20 ticks`);
      }

      // ── THE HIJACK REACHES A CHANNEL WHOSE OWN TRANSMITTER IS DARK ────────────
      // The point of the whole system. A seized channel is not putting out its own
      // programme, so asking whether its gallery still has power is asking about a
      // station that is no longer transmitting — and before this the dark channel
      // went off_air BEFORE the override was ever consulted, which missed exactly
      // the screens a hijack is for.
      const darkChannel = { channelId: 'ch_test_dark', deckZoneId: null, portableDeckZones: [] };
      check('ebs: a channel with no transmitter at all still carries the hijack',
        _test.channelTransmitterLive(darkChannel) === true);

      // ── Live from the studio floor ────────────────────────────────────────────
      const live = await run('ebs source live');
      check('ebs source live: the console re-cuts without being switched off',
        emergencyActive() === true && emergencyStatus()?.mode === 'live', JSON.stringify(emergencyStatus()));
      check('ebs source live: and names the camera it cut to', !!emergencyStatus()?.camLabel, JSON.stringify(emergencyStatus()?.camLabel));
      check('ebs source live: the console agrees', live?.mode === 'live', JSON.stringify(live?.mode));
      {
        const fake = { channelId: 'ch_test_eb', currentFallbackMessages: [] };
        // Slot 0 is a content slot (the ticker takes slot 2 of every 3).
        const m = _test.emergencyMessage(fake, 0);
        check('ebs source live: the air carries a live camera feed',
          m?.style === 'raw' && /^\[LIVE · /.test(m.text || ''), JSON.stringify(m));
      }

      // Cutting between cameras must NOT re-engage — a vision mix during a live
      // address should not restart the address.
      const secondCam = cams[1];
      await run('ebs cam 2');
      check('ebs cam: re-points the live feed', emergencyStatus()?.camLabel === secondCam.label, JSON.stringify(emergencyStatus()?.camLabel));
      check('ebs cam: without releasing the air', emergencyActive() === true);
      check('ebs cam: and remembers the choice on the console', deckNow()?.flags?.eb_cam === secondCam.key, JSON.stringify(deckNow()?.flags?.eb_cam));
      const badCam = await run('ebs cam 99');
      check('ebs cam: refuses a camera that is not there', badCam?.type === 'error' && /no camera matches/i.test(badCam.message || ''), JSON.stringify(badCam));
      check('ebs cam: and the refusal did not take the feed down', emergencyActive() === true);

      // ── The live relay: the room goes out with the picture ────────────────────
      // The camera is pointed at this room, so what happens in it is televisable.
      // `_relayableAir` is the ONE place that decides what a camera can see, shared
      // with the studio relay; assert the shape rather than a delivery, which needs
      // a player standing in front of a tuned set.
      check('ebs live: a spoken line in shot is televisable',
        _test.relayableAir({ type: 'say', message: '<span class="speech-line">Vess says, "Remain where you are."</span>' })
          === 'Vess says, "Remain where you are."');
      check('ebs live: the show\'s own performance is never re-aired',
        _test.relayableAir({ type: 'output', message: 'a line', _fromBroadcast: true }) === null);
      check('ebs live: foot traffic is not television',
        _test.relayableAir({ type: 'output', message: 'someone walks in', _movement: true }) === null);

      // ── Off ───────────────────────────────────────────────────────────────────
      const off = await run('ebs off');
      check('ebs off: releases the airwaves', emergencyActive() === false && off?.on === false, JSON.stringify(off?.on));
      check('ebs off: and the transmitter gate goes back to telling the truth',
        _test.channelTransmitterLive(darkChannel) === false);

      // A live source with no camera can never go to air, and the refusal has to come
      // from the one engage path rather than from a second opinion about cameras.
      {
        const saved = structuredClone(deckNow().flags);
        // A console standing in a room with no camera: the deck is real, the roster
        // is not. Drive it through the same helper the verb uses.
        const camless = { ...deckNow(), zone_id: 'zone_nonexistent_room', flags: { ...saved, eb_mode: 'live' } };
        check('ebs: a live console with no camera in the room has nothing to cut to',
          _test.emergencyCamera(camless, camless.flags) === null);
      }

      await run('ebs source cassette');
      const onAgain = await run('ebs on');
      check('ebs: the cassette source goes back to air', emergencyActive() === true && emergencyStatus()?.mode === 'cassette', JSON.stringify(emergencyStatus()));
      check('ebs: and the console says which tape', onAgain?.airingSource, JSON.stringify(onAgain?.airingSource));
      await run('ebs off');

      // `airemergency` is the older way in and must obey the same rules — one engage
      // path, never two sets of them.
      await run('airemergency');
      check('airemergency: still throws the same switch', emergencyActive() === true);
      await run('endemergency');
      check('endemergency: still releases it', emergencyActive() === false);

      // Leave the console exactly as content authored it.
      // ⚠ Through updateFurniture, never a bare UPDATE: the world.furniture Map is the
      // write funnel every reader here goes through, and a raw statement leaves the
      // cache holding the test's own edits for the rest of the suite.
      await updateFurniture(deckNow().id, { flags: JSON.stringify(authored) });
      
    } finally {
      stopEmergency();
      player.role = savedRole;
      player.current_zone = savedZone;
    }
  }

  // ── Tablet TV: the portable tuner ────────────────────────────────────────────
  // The Tablet TV app is its own receiver — `tablettune` must resolve a channel
  // straight from the in-memory runtime, with NO broadcast_receiver furniture in
  // the zone (which is exactly what `tune` refuses to do).
  const chans = getTvChannelList();
  check('channel list is in-memory and shaped for the dial',
    Array.isArray(chans) && chans.every(c => typeof c.number === 'number' && c.channelId),
    JSON.stringify(chans.slice(0, 3)));
  check('channel list is sorted by dial number',
    chans.every((c, i) => i === 0 || chans[i - 1].number <= c.number), JSON.stringify(chans.map(c => c.number)));

  const player = getPlayer();
  check('no tablet tuner before tuning', getTabletTunedChannel(player.id) === null, String(getTabletTunedChannel(player.id)));

  // `tune` in a zone with no device is refused — the contrast that makes the point.
  const wallTune = await run(`tune ${chans[0]?.number ?? 1}`);
  check('wall `tune` still needs a device in the zone',
    wallTune?.type === 'output' && /no broadcast-capable device/i.test(wallTune.message || ''), JSON.stringify(wallTune));

  // Channel 0 is the VCR input now, not the off switch — a tablet standing in a
  // room with a tape deck can watch the tape on 0 like anything else. So pick a
  // real station here, and power down with the word.
  const station = chans.find(c => c.number > 0) || chans[0];
  if (station) {
    await run(`tablettune ${station.number}`);
    check('tablettune registers the portable tuner with no furniture',
      getTabletTunedChannel(player.id) === station.channelId,
      `${getTabletTunedChannel(player.id)} vs ${station.channelId}`);

    await run('tablettune off');
    check('tablettune off powers the tablet screen down', getTabletTunedChannel(player.id) === null, String(getTabletTunedChannel(player.id)));

    // An unknown dial position is silent (the dial sweeps across dead frequencies)
    // and must not leave a stale tuner behind.
    const dead = await run('tablettune 998');
    check('tuning a dead frequency is silent', dead === null || dead === undefined, JSON.stringify(dead));
    check('a dead frequency leaves no tuner', getTabletTunedChannel(player.id) === null, String(getTabletTunedChannel(player.id)));

    // ── The delivery pass, end to end ──────────────────────────────────────────
    // Registering a tuner is only half the job: the tick has to actually PUSH the
    // program to a player with no broadcast device anywhere near them. This drives
    // real ticks and captures what reached that player. (Regression guard for the
    // "tablet TV shows no programs" class of bug — tuner set, nothing delivered.)
    const orig = getBroadcast();
    const caught = [];
    setBroadcast((zoneId, payload, exclude, toPlayer) => {
      if (toPlayer === player.id) caught.push(payload);
      return orig?.(zoneId, payload, exclude, toPlayer);
    });
    let threw = null;
    try {
      await run(`tablettune ${chans[0].number}`);
      // A channel emits on its own cadence; a handful of ticks covers a beat.
      for (let i = 0; i < 12; i++) await _test.broadcastTick();
    } catch (e) { threw = e; } finally { setBroadcast(orig); }

    check('tablet delivery pass runs without throwing', !threw, threw && (threw.stack || threw.message));
    const forTuner = caught.filter(m => m && (m.type === 'broadcast' || m.type === 'tv_overlay'));
    const wrongChannel = forTuner.filter(m => (m.channel ?? m.channelId) !== chans[0].channelId);
    check('anything delivered to the tablet is for the tuned channel', wrongChannel.length === 0,
      JSON.stringify(wrongChannel.slice(0, 2)));
    // Report delivery volume either way — a live channel proves the pipe, a silent
    // one at least proves the pass is wired and channel-correct.
    console.log(`    · tablet tuner received ${forTuner.length} program message(s) over 12 ticks`
      + (forTuner.length ? '' : ' (channel idle/off-air this window — pipe not exercised)'));
    tabletTunersClear(player.id);
  }

  // ── Catch-up on tune ────────────────────────────────────────────────────────
  // A beat holds for as long as its line takes to read, so a viewer who tunes in
  // just after one landed used to face a blank screen until the next — the "I have
  // to change to the channel twice" bug. Tuning now replays what's on air.
  {
    const [cid, state] = [..._test.channelRuntime.entries()][0] || [];
    if (state) {
      const savedBeat = state.lastBeat;
      const orig3 = getBroadcast();
      const got = [];
      setBroadcast((zoneId, payload, exclude, toPlayer) => {
        if (toPlayer === player.id) got.push(payload);
        return orig3?.(zoneId, payload, exclude, toPlayer);
      });
      try {
        state.lastBeat = null;
        _test.sendCatchUp(player.id, cid);
        check('a dead channel replays nothing', got.length === 0, JSON.stringify(got.slice(0, 2)));

        state.lastBeat = { text: "And we're back.", style: 'raw', programName: 'The Regress Hour', duration: 6, hasGameday: false, graphic: null };
        _test.sendCatchUp(player.id, cid);
        const beat = got.find(m => m?.type === 'broadcast');
        check('tuning replays the beat already on air', beat?.message === "And we're back.", JSON.stringify(got.slice(0, 2)));
        check("the replay is flagged catchUp (so it isn't re-narrated)", beat?.catchUp === true, JSON.stringify(beat));
        check('the replay carries the program name', beat?.programName === 'The Regress Hour', JSON.stringify(beat));

        got.length = 0;
        state.lastBeat = { text: '>> headline <<', style: 'ticker' };
        _test.sendCatchUp(player.id, cid);
        check("a ticker beat isn't replayed", got.length === 0, JSON.stringify(got.slice(0, 2)));

        // A stale score-bug must never be painted over whatever is on now.
        got.length = 0;
        state.lastBeat = { text: 'Line.', style: 'raw', programName: null, duration: null, hasGameday: false, graphic: null };
        state.lastScorebug = { overlayType: 'scorebug', sport: 'baseball' };
        state.lastScorebugAt = Date.now() - 10 * 60 * 1000;
        _test.sendCatchUp(player.id, cid);
        check("a stale score-bug isn't replayed", !got.some(m => m?.overlay?.overlayType === 'scorebug'), JSON.stringify(got));
        // One gesture can register a viewer two or three times (the client's lock check
        // races the server echo), which used to replay the same line each time.
        got.length = 0;
        _test.sendCatchUp(player.id, cid);
        check("the same beat isn't replayed twice to one viewer", got.length === 0, JSON.stringify(got));

        state.lastScorebugAt = Date.now();
        got.length = 0;
        state.lastBeat = { text: 'Next line.', style: 'raw', programName: null, duration: null, hasGameday: false, graphic: null };
        _test.sendCatchUp(player.id, cid);
        check('a live score-bug IS replayed', got.some(m => m?.overlay?.overlayType === 'scorebug'), JSON.stringify(got));

        // A game's league table rides only its first Gameday payload, so a viewer who
        // tunes in mid-game gets it with the catch-up instead.
        got.length = 0;
        const table = [{ team: 'Rats', wins: 9, losses: 2, rd: 14 }];
        _test.recordBeat(state, { text: 'Top of the 1st.', style: 'raw' }, null, null, { overlayType: 'gameday', sport: 'baseball', phase: 'half', standings: table }, Date.now());
        _test.recordBeat(state, { text: 'He grounds out.', style: 'raw' }, null, null, { overlayType: 'gameday', sport: 'baseball', kind: 'groundout' }, Date.now());
        _test.sendCatchUp(player.id, cid);
        const gdc = got.find(m => m?.overlay?.overlayType === 'gameday');
        check('a late tuner gets the game\'s table with the catch-up', gdc?.overlay?.kind === 'groundout' && gdc.overlay.standings?.[0]?.team === 'Rats', JSON.stringify(gdc).slice(0, 200));
        // Hockey on the same channel next: its payloads carry no table, and Deadball's
        // kept one mustn't be pinned onto them.
        got.length = 0;
        _test.recordBeat(state, { text: 'Puck drop.', style: 'raw' }, null, null, { overlayType: 'gameday', sport: 'hockey', type: 'faceoff' }, Date.now());
        _test.sendCatchUp(player.id, cid);
        const gdh = got.find(m => m?.overlay?.overlayType === 'gameday');
        check("a hockey catch-up isn't sent Deadball's table", gdh?.overlay?.sport === 'hockey' && !('standings' in gdh.overlay), JSON.stringify(gdh).slice(0, 200));
      } finally {
        setBroadcast(orig3);
        state.lastBeat = savedBeat;
        delete state.lastScorebug; delete state.lastScorebugAt;
        delete state.lastGameday; delete state.lastGamedayAt; delete state.lastStandings;
      }
    }
  }

  // ── Standings button ────────────────────────────────────────────────────────
  // The on-demand league table behind the 🏆 toggle on both TV surfaces. The
  // transient corner bug is server-thrown; this path is the viewer asking for it,
  // so it must answer whether or not a game happens to be airing right now.
  {
    const orig2 = getBroadcast();
    const replies = [];
    setBroadcast((zoneId, payload, exclude, toPlayer) => {
      if (toPlayer === player.id && payload?.type === 'tv_standings') replies.push(payload);
      return orig2?.(zoneId, payload, exclude, toPlayer);
    });
    try {
      emit('tv.standings', { playerId: player.id });
      await new Promise(r => setTimeout(r, 120));   // handler is async (action + cache)
    } finally { setBroadcast(orig2); }

    check('tv.standings answers the requesting player', replies.length === 1, `got ${replies.length}`);
    const st = replies[0];
    check('standings payload carries a title and row array', !!st && typeof st.title === 'string' && Array.isArray(st.rows), JSON.stringify(st).slice(0, 160));
    check('standings rows are shaped for the table', !st?.rows.length || st.rows.every(r =>
      typeof r.team === 'string' && Number.isFinite(r.wins) && Number.isFinite(r.losses) && Number.isFinite(r.rd)),
      JSON.stringify(st?.rows?.slice(0, 2)));
  }

  // ── The venue and its skyline ───────────────────────────────────────────────
  // A league's park and the city round it go to a viewer once a revision (tv_venue), for
  // the 3-D park's set. The skyline is built from the map's own tiles and names no region:
  // tried on tiles built by hand, then on Deadball's own venue in the world.
  {
    const { skylineFrom } = await import('../../client/shared/skyline-manifest.js');
    const zones = [];
    const tile = (x, y, flags = {}) => zones.push({ id: `t${x}_${y}`, map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, flags });
    for (let x = 0; x <= 30; x++) for (let y = 0; y <= 30; y++) {
      if (x === 2 || x === 26 || y === 26) tile(x, y, { curtain: true });
      else if (y < 6) tile(x, y, { terrain: 'water' });
      else tile(x, y, { terrain: 'concrete' });
    }
    tile(15, 15, { building_type: 'office', floors: 9, building_name: 'Near', facade: true, entrance: 'south' });
    tile(20, 22, { building_type: 'office', floors: 3 });
    tile(9, 4, { building_type: 'pier', terrain: 'water' });
    const sk = skylineFrom(zones, { x: 14.5, y: 14.5 }, { radius: 12 });
    check('skyline: the Curtain on three sides, a shore on the fourth',
      sk.edges.w?.wall === 2.5 && sk.edges.e?.wall === 26.5 && sk.edges.s?.wall === 26.5 && sk.edges.n?.shore?.length === 23 && sk.edges.n.shore.every(([, y]) => y === 6),
      JSON.stringify(sk.edges).slice(0, 200));
    check('skyline: the buildings in reach, nearest first, a pier on the water, a door from its facade',
      sk.buildings.map((b) => b.t).join() === 'office,office,pier' && sk.buildings[0].e === 'south' && sk.buildings[2].w === 1,
      JSON.stringify(sk.buildings));
    check('skyline: none past the radius', !skylineFrom(zones, { x: 14.5, y: 14.5 }, { radius: 4 }).buildings.some((b) => b.t === 'pier'));

    const deadball = await _test.anySportsScript('baseball');
    if (deadball?.venue?.site) {
      const orig3 = getBroadcast();
      const got = [];
      setBroadcast((zoneId, payload, exclude, toPlayer) => {
        if (toPlayer === player.id && payload?.type === 'tv_venue') got.push(payload);
        return orig3?.(zoneId, payload, exclude, toPlayer);
      });
      try {
        emit('tv.venue', { playerId: player.id, sport: 'baseball' });
        await new Promise(r => setTimeout(r, 120));
      } finally { setBroadcast(orig3); }
      const v = got[0]?.venue;
      check('tv.venue answers with the park\'s site and the skyline round it',
        got.length === 1 && typeof got[0].rev === 'string' && got[0].rev.length > 4 && v?.site?.bearing != null && v.skyline.buildings.length > 100,
        JSON.stringify(got[0] || null).slice(0, 160));
      check('tv.venue: the set\'s edges come from the map', !!v && ['w', 'e', 's', 'n'].every((k) => v.skyline.edges[k]), JSON.stringify(v?.skyline?.edges || null).slice(0, 160));
      check('tv.venue: the skyline stays a few dozen kilobytes', !!got[0] && JSON.stringify(got[0]).length < 40000, String(JSON.stringify(got[0] || '').length));
    }
  }

  // ── Live-text {token} substitution for scripted broadcasts ──────────────────
  // The Quiet Hour (and any scripted graph) may embed {clock}/{weather}/{viewers}/…
  // which resolve at airtime. Guard the safety properties: no-brace text is untouched,
  // unknown tokens are left verbatim, known tokens resolve, and {viewers} reflects the
  // real live tune-in count (minus the set the line is addressing), not a fake number.
  {
    const bb = {};
    const st2 = { channelId: 'ch_does_not_exist' };
    check('subTokens leaves brace-free text untouched',
      _test.subTokens("There's nothing on.", st2.channelId, st2, bb) === "There's nothing on.", 'plain text changed');
    check('subTokens leaves an unknown token verbatim',
      _test.subTokens('who makes {mystery}?', st2.channelId, st2, bb) === 'who makes {mystery}?', 'unknown token mangled');
    const out = _test.subTokens('It is {clock}. {viewers} awake.', st2.channelId, st2, bb);
    check('subTokens resolves known tokens (no leftover braces)', /^It is .+\. [\d,]+ awake\.$/.test(out), out);

    // A channel with no one tuned in reports 0 other viewers, never a negative number.
    check('otherViewers floors at 0 on an empty channel', _test.otherViewers('ch_does_not_exist') === 0,
      String(_test.otherViewers('ch_does_not_exist')));

    check('untilFour counts down to the 04:00 service',
      _test.untilFour(2 * 60 + 47) === '1 hour and 13 minutes', _test.untilFour(2 * 60 + 47));
    check('untilFour wraps past four o’clock', /hour/.test(_test.untilFour(5 * 60)), _test.untilFour(5 * 60));
  }

  // ── Live realism: cameras, room authority, impaired delivery ────────────────
  // A camera direction is executed by a physical unit or it doesn't happen; a line
  // belongs to whoever is standing there to say it; and what the actor is on decides
  // what actually comes out of their mouth.
  {
    // Camera roster → on-air unit names, round-robin so a multi-cam studio cuts.
    check('cameraLabel reads the crew number out of a builder-made camera id',
      _test.cameraLabel('cam_ch_7_1782953079593_3_1782953083630', 0) === 'Camera 3',
      _test.cameraLabel('cam_ch_7_1782953079593_3_1782953083630', 0));
    check('cameraLabel falls back to roster position for an unnumbered id',
      _test.cameraLabel('cam_weird', 1) === 'Camera 2', _test.cameraLabel('cam_weird', 1));

    // The studio floor relay crosses from an innerHTML surface (the game log) to a
    // renderMarkup one (every screen), which escapes — so a relayed room line has to
    // shed its markup on the way to air or the tags air as literal text.
    {
      const speech = _test.plainAir('<span class="speech-line">Yolanda Sarr says, "Live from the ruins."</span>');
      check('plainAir sheds the log wrapper and keeps the line',
        speech === 'Yolanda Sarr says, "Live from the ruins."', speech);
      check('plainAir leaves a line that was never wrapped alone',
        _test.plainAir('A camera pivots.') === 'A camera pivots.', _test.plainAir('A camera pivots.'));
      const ent = _test.plainAir('<span style="color:var(--yellow)">Bo &amp; Cass &lt;the twins&gt;</span>');
      check('plainAir decodes entities back to the characters they stood for',
        ent === 'Bo & Cass <the twins>', ent);
      check('plainAir returns nothing for a message that was only markup',
        _test.plainAir('<span class="x"></span>') === '', JSON.stringify(_test.plainAir('<span class="x"></span>')));
    }

    const zid = '__regress_studio__';
    _test.zoneCameras.set(zid, [{ id: 'a', label: 'Camera 1' }, { id: 'b', label: 'Camera 2' }]);
    const st = {};
    const picks = [_test.pickCamera(zid, st), _test.pickCamera(zid, st), _test.pickCamera(zid, st)];
    check('pickCamera rotates through the zone roster',
      picks[0].id !== picks[1].id && picks[0].id === picks[2].id,
      picks.map(p => p && p.id).join(','));
    check('pickCamera returns null where no working camera is registered',
      _test.pickCamera('__no_such_zone__', {}) === null, 'a shot was produced with no camera');
    _test.zoneCameras.delete(zid);

    // Room authority: the stand-by card is for an empty stage, not a short-handed one.
    const graph = { nodes: {
      a: { type: 'npc_anchor', data: { npc_id: 'npc_host' } },
      b: { type: 'npc_anchor', data: { npc_id: 'npc_sidekick' } },
    } };
    check('anyCastPresent is false with no studio zone',
      _test.anyCastPresent(graph, null) === false, 'phantom cast');
    check("anyCastPresent is false for a zone that doesn't exist",
      _test.anyCastPresent(graph, '__no_such_zone__') === false, 'phantom cast');

    // ON AIR OUTRANKS THE TIMETABLE. A cast member the runner is currently putting on
    // air counts as working, so nothing walks them off the set mid-episode when their
    // slot's window ticks over underneath them.
    const onAirState = {};
    const nowFake = Date.now();
    check('the cast list is read off the graph, not the schedule',
      [...(_test.graphCastIds(graph) || [])].join(',') === 'npc_host,npc_sidekick',
      [...(_test.graphCastIds(graph) || [])].join(','));
    check('nobody is held on set before a programme has aired',
      _test.isOnAirNow(onAirState, 'npc_host', nowFake) === false, 'held with nothing on air');
    _test.stampOnAirCast(onAirState, graph, nowFake);
    check('an anchored actor is on shift while their show is on air',
      _test.isOnAirNow(onAirState, 'npc_host', nowFake) === true, 'the cast were let go mid-show');
    check("someone who isn't in the show isn't held by it",
      _test.isOnAirNow(onAirState, 'npc_passerby', nowFake) === false, 'a bystander was put on shift');
    check('the hold expires once the channel stops ticking',
      _test.isOnAirNow(onAirState, 'npc_host', nowFake + _test.ON_AIR_CAST_HOLD_MS + 1) === false,
      'the cast were pinned to the set forever');

    // Impaired delivery. A sober actor reads the script exactly as written.
    const line = 'The Basin wakes to clear skies and a curfew that ended at four.';
    check('a sober actor delivers the line verbatim',
      _test.garbleLine(line, 0) === line, _test.garbleLine(line, 0));
    check('impairment below the floor still delivers verbatim',
      _test.garbleLine(line, 0.25) === line, _test.garbleLine(line, 0.25));
    // Past the floor it must ALWAYS visibly degrade — never a silent no-op.
    let allChanged = true;
    for (let i = 0; i < 40; i++) if (_test.garbleLine(line, 0.9) === line) allChanged = false;
    check('a wrecked actor never delivers the line clean', allChanged, 'a garbled take came back verbatim');
    check('garbleLine tolerates an empty line', _test.garbleLine('', 0.9) === '', 'empty line mangled');

    // Impairment reads the live NPC; an id that isn't anyone is simply sharp.
    const imp = _test.actorImpairment('__nobody__');
    check('an unknown actor reads as unimpaired', imp.level === 0 && imp.out === false, JSON.stringify(imp));

    // ── The voice of a state ──────────────────────────────────────────────────
    // Delivery is written against npc-drugs' STATES, never against drug names, so
    // a habit is pure content. These guard that seam rather than the prose.

    // Every state npc-drugs can set has a row here. A state without one falls to
    // the generic voice silently — an anchor on a new drug family sounding exactly
    // like an anchor on a bottle, with nothing to say it went wrong.
    const NPC_DRUG_STATES = ['loose', 'flee', 'wired', 'belligerent',
      'mellow', 'tripping', 'dissociated', 'lucid'];
    const missingVoice = NPC_DRUG_STATES.filter(k => !_test.DELIVERY[k]);
    check('every dose state npc-drugs can set has a delivery voice',
      missingVoice.length === 0, 'no voice for: ' + missingVoice.join(', '));

    // A row missing a pool would air an empty aside — the host's name and nothing.
    const shallow = Object.entries(_test.DELIVERY).filter(([, v]) =>
      !(v.fumbles || []).length || !(v.offscript || []).length || !(v.collapse || []).length);
    check('every delivery voice carries all three line pools',
      shallow.length === 0, 'thin rows: ' + shallow.map(([k]) => k).join(', '));

    // Two actors equally far gone must not sound the same. A stimulant never slurs
    // (the tell is speed); drink always can. This is the whole reason state is
    // threaded through at all, so it is asserted rather than assumed.
    let wiredSlurred = false, drunkSlurred = false;
    for (let i = 0; i < 60; i++) {
      if (/sh|in'|an'/.test(_test.garbleLine(line, 0.95, 'wired'))) wiredSlurred = true;
      if (/sh|in'|an'/.test(_test.garbleLine(line, 0.95, 'drunk'))) drunkSlurred = true;
    }
    check('a wired actor never slurs — the tell is speed', !wiredSlurred, 'a stimulant slurred');
    check('a drunk actor does slur', drunkSlurred, 'drink never softened a consonant');

    // Inert states are states, not impairments: lucid must come back verbatim even
    // above the floor, or the no-op guard mangles a man reading it better.
    let lucidClean = true;
    for (let i = 0; i < 40; i++) if (_test.garbleLine(line, 0.95, 'lucid') !== line) lucidClean = false;
    check('a lucid actor delivers the line verbatim', lucidClean, 'a nootropic garbled the take');

    // An unknown state falls back to the generic voice rather than throwing — the
    // pre-state behaviour, which is what makes this safe for any two-argument call.
    check('an unknown state still degrades in the generic voice',
      _test.garbleLine(line, 0.9, 'nonsense_state') !== line, 'unknown state aired clean');
    check('garbleLine with no state at all still degrades',
      _test.garbleLine(line, 0.9) !== line, 'stateless call aired clean');

    // Authored lines REPLACE the state pool. A host given their own drunk aside
    // must be heard saying it, not it diluted by the house set.
    const ownLine = '...Marguerite. Marguerite, are you watching this.';
    const voiced = { flags: { delivery_lines: { drunk: { offscript: [ownLine] } } } };
    let houseAside = false, heardOwn = false;
    for (let i = 0; i < 80; i++) {
      const took = _test.garbleLine(line, 0.98, 'drunk', voiced);
      if (took.includes(ownLine)) heardOwn = true;
      if (/is there water|nine years/i.test(took)) houseAside = true;
    }
    check('an authored aside is heard', heardOwn, 'the NPC never said their own line');
    check('an authored pool replaces the house pool', !houseAside, 'the house set leaked through');

    // 'any' is the catch-all, and a state the author did not cover still falls
    // through to the state pool rather than to nothing.
    const anyVoiced = { flags: { delivery_lines: { any: { fumbles: ['...hah...'] } } } };
    let sawAny = false;
    for (let i = 0; i < 80; i++) if (_test.garbleLine(line, 0.9, 'mellow', anyVoiced).includes('...hah...')) sawAny = true;
    check("an 'any' pool reaches a state it doesn't name", sawAny, 'the catch-all never fired');

    // The take that never happens. Each state dies its own way, and the pool must
    // never come back empty.
    for (const st of ['flee', 'loose', 'wired', null, 'nonsense_state']) {
      check('a collapse always has words (' + (st || 'no state') + ')',
        (_test.collapseLine(st) || '').length > 8, 'empty collapse for ' + st);
    }
    check('a bolting deliriant leaves the set',
      _test.DELIVERY.flee.collapse.join(' ') !== _test.DELIVERY.paranoid.collapse.join(' '),
      'fleeing reads identically to standing there paranoid');

    // Slur is scaled, never absolute: at zero it is the identity.
    check('slur at zero is the identity', _test.slurLine(line, 0) === line, _test.slurLine(line, 0));
  }

  // ── Studio audience door ────────────────────────────────────────────────────
  // A pass is a dated document and the door is a person: both halves are tested
  // here because both are the point (a pass that admits you any night is not a
  // ticket, and a gate you can't kill or wait out is not a bouncer).
  {
    const A = _audienceTest;
    const G = 8;
    const talkshow = { playback_mode: 'talkshow', broadcastId: 'bc_x', broadcastName: 'Tonight', talkshowScript: { airSlots: [7] } };
    const gameshow = { playback_mode: 'gameshow', broadcastId: 'bc_y', broadcastName: 'The Last Lot', gameshowScript: { airSlots: [4] } };
    const rerun    = { playback_mode: 'clip', broadcastId: 'bc_z', broadcastName: 'Rerun' };
    const state = { playlist: [rerun, gameshow, talkshow] };

    check('doorman works every hour but the dead ones',
      A.doormanOnShift(8) && A.doormanOnShift(23) && A.doormanOnShift(1) && !A.doormanOnShift(2) && !A.doormanOnShift(7),
      'shift window should be 08:00 through 02:00');

    check('a taping is found in its own airtime block',
      A.showingAt(state, 100 * G + 7, G) === talkshow && A.showingAt(state, 100 * G + 4, G) === gameshow,
      "airSlots didn't select the right show");
    check('no taping outside any show’s block',
      A.showingAt(state, 100 * G + 0, G) === null && A.showingAt(state, 100 * G + 5, G) === null,
      'a pre-recorded rerun was mistaken for a live house');
    check('a pre-recorded playlist never opens a house',
      A.showingAt({ playlist: [rerun] }, 12345, G) === null, "clips aren't tapings");
    check('an acted show with no airSlots is continuous',
      A.showingAt({ playlist: [{ playback_mode: 'talkshow', talkshowScript: {} }] }, 12345, G) !== null,
      'no airSlots should mean every block');

    // The slot IS the date — that is what makes yesterday's pass worthless
    // without a calendar being stored anywhere.
    const slotA = 100 * G + 7, slotB = 101 * G + 7;
    check('the same block on two days is two different showings', slotA !== slotB, "slot index isn't self-dating");
    check('a slot resolves to the in-game calendar date it falls on',
      A.dateForSlot(slotA, G) === new Date(100 * 86400000).toISOString().slice(0, 10)
      && A.dateForSlot(slotB, G) !== A.dateForSlot(slotA, G),
      A.dateForSlot(slotA, G));

    // The instance key is what stops two passes to two different nights merging
    // into one row and laundering the wrong date onto the survivor.
    check('a stamped pass never stack-merges',
      rowIsInstanced({ custom_data: { show_pass: { slot: slotA } } }) === true, "show_pass isn't an instance key");
    check('an unstamped pass still stacks normally',
      rowIsInstanced({ custom_data: {} }) === false, 'plain rows should merge');
    check('the SQL merge predicate excludes stamped rows',
      NOT_INSTANCED_SQL.includes('show_pass'), 'NOT_INSTANCED_SQL drifted from INSTANCE_KEYS');

    // The gate is a registered law, not something wired into movement by hand.
    check('the audience door registers as a move gate',
      getRegisteredMoveGates().includes('broadcast:audience-door'), getRegisteredMoveGates().join(','));
  }

  // ── Sermons (@type sermon) ──────────────────────────────────────────────────
  // Dynamic but NOT acted: the whole point is that it reads the live news feed
  // through a doctrine, spawns nobody, and never sounds the same twice.
  {
    const A = _test;
    const script = {
      verger: 'The Verger',
      celebrants: [
        { name: 'Deacon-Prime Orrin Vance', title: 'the soft one', tag: 'prime' },
        { name: 'Brother Duc, Third Seal', title: 'the counter', tag: 'duc' },
        { name: 'Curate Halm', title: 'the loud one', tag: 'halm' },
      ],
      pools: {
        call: ['The eye is open.'],
        invocation: ['Architect, we bring you nothing you require.'],
        greeting: ['I am {celebrant}, {title}.'],
        creed: ['Say it with me.'], 'creed.response': ['The flesh was an interval.'],
        'reading.lead': ['Hear what was permitted: {headline}'],
        'reading.text': ['{body}'],
        'exegesis.prime': ["There's no cruelty in it."],
        'exegesis.duc': ['I counted. Fourteen.'],
        'exegesis.halm': ['This is IT.'],
        'exegesis.warning': ['Take this as the tap on the shoulder it is.'],
        exegesis: ['The flesh was only ever an interval.'],
        'interjection.duc': ['Fourteen.'], interjection: ['Hold there a moment.'],
        amen: ['So it routes.'],
        'testimony.lead': ['We have a witness.'], testimony: ["It doesn't hurt."],
        hymn: ['♪ We were the load. ♪'],
        tithe: ['The Order takes no money at the door.'],
        homily: ["You have spent this week resenting a thing that doesn't know your name."],
        benediction: ['Go now. Be less each day.'],
        signoff: ['This has been The Calm Eye.'],
      },
    };
    const stories = [
      { headline: 'H1 Substation Fails', body: 'B1 upstream.', byline: 'Sentinel' },
      { headline: 'H2 Clinic Intake', body: 'B2 declined to say.', byline: 'Wire' },
      { headline: 'H3 Nine Days Alone', body: 'B3 no roster.', byline: 'Wire' },
    ];
    const linesOf = g => Object.values(g.nodes).filter(n => n.type === 'say').map(n => n.data.text);

    const g0 = A.assembleSermonGraph(script, 'bc', stories, 'b0');
    const l0 = linesOf(g0);
    check('sermon: a service assembles', l0.length >= 12, String(l0.length));
    check('sermon: the week\'s headlines are preached', stories.every(s => l0.some(t => t.includes(s.headline))),
      JSON.stringify(l0.slice(0, 2)));
    check('sermon: leaves no unfilled {tokens}', !l0.some(t => /\{\w+\}/.test(t)), l0.find(t => /\{\w+\}/.test(t)) || 'clean');
    check('sermon: celebrants are named, not anchored to NPCs',
      l0.some(t => t.startsWith('Deacon-Prime') || t.startsWith('Brother Duc') || t.startsWith('Curate Halm')), l0[2] || '');
    check('sermon: the congregation answers unattributed',
      l0.some(t => t === 'So it routes.'), 'no bare responsive line');

    // Not acted: no presence gate, or a service would drop to PLEASE STAND BY with
    // an empty studio — the one thing a pre-recorded-feeling programme must not do.
    check('sermon: never presence-gates', !g0._requireHost, 'graph demands a host');

    // Variety is the brief. Twelve services off the SAME three headlines must differ.
    const sigs = new Set();
    for (let k = 0; k < 12; k++) sigs.add(linesOf(A.assembleSermonGraph(script, 'bc', stories, `b${k}`)).join('|'));
    check('sermon: no two services are the same', sigs.size >= 10, `${sigs.size}/12 distinct`);

    // A weekly show rides the day mask that already existed — ensureTalkshowSlot is
    // the shared pinning path, so this is what makes talk shows and game shows weekly too.
    check('sermon: @airday makes the pinned slot weekly',
      A.filmDayMask([7], 0) === (1 << 6), String(A.filmDayMask([7], 0)));
  }

  // ── Films (@type film) ──────────────────────────────────────────────────────
  // A feature is an ordinary linear graph, so nothing here re-assembles. What is
  // worth pinning is the seek: a film is authored in REAL minutes and every other
  // daily slot is authored on the in-game clock, so a late viewer only lands on the
  // right shot if the reel is walked with a real-time offset and the walk is allowed
  // to run long enough to reach the far end of a two-hour picture.
  {
    const A = _test;
    // A chain of 900 lines, each held ~5s — roughly the shape of a feature.
    const nodes = { start: { type: 'start', data: {}, } };
    let prev = 'start';
    const edges = [];
    for (let n = 0; n < 900; n++) {
      const id = `s${n}`;
      nodes[id] = { type: 'say', data: { text: 'x'.repeat(36), style: 'verbatim' } };
      edges.push({ fromNode: prev, fromPort: 'next', toNode: id });
      prev = id;
    }
    const film = { _start: 'start', nodes, edges, _normalized: true };
    const holdMs = A.nodeHoldMs(nodes.s0);

    const bbHead = {};
    A.seekGraph(film, bbHead, 1, 0);
    check('film: a viewer at the start lands on the first shot', bbHead.currentNode === 's0', String(bbHead.currentNode));

    // Deep seek — the beat this is really guarding. With the old fixed 2000-step
    // budget a walk this far in stopped early and stranded the viewer mid-picture.
    const target = 850;
    const bbLate = {};
    // Per-node airtime has to be derived the way the walker derives it — round the
    // hold up to the broadcast tick. This used to round to a flat 5000ms, which only
    // happened to match while a 36-char line held 4360ms; when the hold was refitted
    // the seek overshot the 900-node reel, wrapped, and landed on s162.
    const perNodeMs = Math.ceil(holdMs / 1000) * 1000;
    A.seekGraph(film, bbLate, target * perNodeMs + 10, 0);
    check('film: a late viewer lands deep in the reel, not stranded partway',
      bbLate.currentNode === `s${target}`, `${bbLate.currentNode} (wanted s${target})`);

    // The reel does not restart for the latecomer — that is the whole point of
    // pinning a picture to a block instead of looping it per viewer.
    check('film: seeking never rewinds to the head', bbLate.currentNode !== 's0', String(bbLate.currentNode));

    // A film's slot reserves the screening block, like a talk show's — and, uniquely,
    // it must do so even when @length set an override_duration, because a film's
    // @length is REAL seconds and a slot is measured in in-game seconds.
    check('film: a slot reserves the whole screening block',
      A.broadcastDuration({ playback_mode: 'film' }) === A.sportsSlotMs() / 1000,
      String(A.broadcastDuration({ playback_mode: 'film' })));
    check('film: a real-time @length never becomes the slot length',
      A.broadcastDuration({ playback_mode: 'film', override_duration: 9000 }) === A.sportsSlotMs() / 1000,
      String(A.broadcastDuration({ playback_mode: 'film', override_duration: 9000 })));

    // The letterbox matte is a persistent layer, not a card: it must cost no airtime,
    // or every switch of it would eat five seconds of the picture.
    check('film: the letterbox matte holds no airtime',
      A.nodeHoldMs({ type: 'overlay', data: { overlayType: 'letterbox', duration_s: 0, on: true } }) === 0, 'letterbox is free');
    // A block's REAL length is (24h / timeScale) / 8 — sixty real minutes on the
    // world's 3x clock. A feature does not fit in one, so it reserves a run of them.
    const blockSec = A.sportsSlotMs() / 1000;
    check('film: a short picture takes one block', A.filmBlocksNeeded(blockSec * 0.5) === 1, String(A.filmBlocksNeeded(blockSec * 0.5)));
    check('film: a feature reserves as many blocks as its runtime needs',
      A.filmBlocksNeeded(blockSec * 2.4) === 3, String(A.filmBlocksNeeded(blockSec * 2.4)));
    check("film: a runtime of exactly one block doesn't over-reserve",
      A.filmBlocksNeeded(blockSec) === 1, String(A.filmBlocksNeeded(blockSec)));

    // The run is measured from its STAMPED head, or a multi-block picture restarts from
    // the distributor card every time the schedule rolls into the next slot.
    const BLOCK = 3 * 3600;
    const HEAD = 21 * 3600;
    const run = [
      { broadcastId: 'f', startTime: 21 * 3600, duration: BLOCK, filmRunStart: HEAD },  // 21:00 → 24:00
      { broadcastId: 'f', startTime: 0,         duration: BLOCK, filmRunStart: HEAD },  // 00:00 → 03:00
      { broadcastId: 'f', startTime: 3 * 3600,  duration: BLOCK, filmRunStart: HEAD },  // 03:00 → 06:00
    ];
    check('film: elapsed in the first block counts from the start of the picture',
      A.filmRunElapsed(run[0], 21 * 3600 + 600) === 600, String(A.filmRunElapsed(run[0], 21 * 3600 + 600)));
    check("film: the second block doesn't rewind the picture — the run wraps midnight",
      A.filmRunElapsed(run[1], 600) === BLOCK + 600, String(A.filmRunElapsed(run[1], 600)));
    check('film: the third block keeps counting from the head',
      A.filmRunElapsed(run[2], 3 * 3600 + 600) === 2 * BLOCK + 600, String(A.filmRunElapsed(run[2], 3 * 3600 + 600)));

    // Two SEPARATE showings of the same picture that happen to abut. Inferring the run
    // from which slots touch merged these into one and made the second showing seek
    // past its own ending; the stamp keeps them distinct.
    const twice = [
      { broadcastId: 'f', startTime: 9 * 3600,  duration: BLOCK, filmRunStart: 9 * 3600 },
      { broadcastId: 'f', startTime: 12 * 3600, duration: BLOCK, filmRunStart: 12 * 3600 },
    ];
    check('film: a second showing that abuts the first still starts at the beginning',
      A.filmRunElapsed(twice[1], 12 * 3600 + 60) === 60, String(A.filmRunElapsed(twice[1], 12 * 3600 + 60)));

    // A picture reserving every block used to form a ring with no head to walk back to.
    const ring = [0, 3, 6, 9, 12, 15, 18, 21].map(h => ({ broadcastId: 'f', startTime: h * 3600, duration: BLOCK, filmRunStart: 21 * 3600 }));
    check('film: an all-day picture still measures from its declared start',
      A.filmRunElapsed(ring[4], 12 * 3600) === 15 * 3600, String(A.filmRunElapsed(ring[4], 12 * 3600)));

    // Blocks are reserved whole, so the last one has a remainder. The picture must be
    // over when it is over — the walker wraps to _start on an exhausted chain, so
    // without the runtime check the tail of the screening replays the first act.
    const runtime = 10476;                      // the film's real seconds
    const reserved = A.filmBlocksNeeded(runtime) * blockSec;
    check("film: reserved blocks exceed the runtime (there's always a tail)",
      reserved > runtime, `${reserved}s reserved for ${runtime}s of film`);
    check('film: the tail is smaller than one block',
      reserved - runtime < blockSec, `${Math.round(reserved - runtime)}s tail`);

    // The tail plays the commercial pool, the same rule every loop-filled slot uses —
    // NOT a repeat of the picture, and above all not the film's flat `messages` list,
    // which for a feature is its entire dialogue read out as bare lines.
    const ads = [{ id: 'ad1', messages: [{ text: 'BUY ACID COLA' }, { text: 'IT HURTS' }], message_interval: 5 }];
    const tail0 = _test.fillCommercialTail(0, ads);
    check('film: the screening tail plays a commercial', tail0?.text === 'BUY ACID COLA', JSON.stringify(tail0));
    check('film: the tail walks the pool rather than repeating one frame',
      _test.fillCommercialTail(6, ads)?.text === 'IT HURTS', JSON.stringify(_test.fillCommercialTail(6, ads)));
    check('film: an empty commercial pool gives dead air, never a film repeat',
      _test.fillCommercialTail(0, []) === null, 'no ads → null');

    // ── A commercial is a BROADCAST, not a list of lines ──────────────────────
    // The pool used to be loaded as flat `messages` only, so an ad's title card —
    // the logo, the jingle riding it — never aired at all, and every line got a
    // flat 5s. These pin the pacing that replaced it.
    check('ad: a title card holds long enough to be read',
      _test.nodeHoldMs({ type: 'title_card', data: {} }) === 10000, String(_test.nodeHoldMs({ type: 'title_card', data: {} })));
    check('ad: a zero-duration card is floored, never flashed and gone',
      _test.nodeHoldMs({ type: 'title_card', data: { duration: 0 } }) === _test.CARD_MIN_HOLD_MS,
      String(_test.nodeHoldMs({ type: 'title_card', data: { duration: 0 } })));
    check('ad: a credits card is floored the same way',
      _test.nodeHoldMs({ type: 'credits', data: { duration: 0 } }) === _test.CARD_MIN_HOLD_MS,
      String(_test.nodeHoldMs({ type: 'credits', data: { duration: 0 } })));

    // A graph ad's runtime is measured off its own nodes — the card's hold included —
    // so the pool rotation starts the next ad when this one actually finishes.
    const adGraph = _test.normalizeBroadcastGraph({
      _start: 'n0',
      nodes: {
        n0: { type: 'start', next: 'n1' },
        n1: { type: 'title_card', graphic_id: 'logo', next: 'n2' },
        n2: { type: 'say', text: 'Drink Acid Cola.', holdMs: 4000 },
      },
    });
    check('ad: a graph ad measures its own runtime, card included',
      _test.graphDurationSec(adGraph) === 14, String(_test.graphDurationSec(adGraph)));
    const graphAd = { id: 'ad_g', messages: [], message_interval: 5, graph: adGraph, durationSec: 14 };
    check('ad: a graph ad paces the pool off that runtime, not off its line count',
      _test.adDurationSec(graphAd) === 14, String(_test.adDurationSec(graphAd)));
    check('ad: a flat ad still paces off lines × interval',
      _test.adDurationSec(ads[0]) === 10, String(_test.adDurationSec(ads[0])));
    // Rotation is positional and deterministic — every TV is on the same ad at the
    // same second, which the old per-channel round-robin counters could not promise.
    const pool = [graphAd, ads[0]];
    check('ad: the pool walks in order', _test.adAt(pool, 0)?.ad.id === 'ad_g', JSON.stringify(_test.adAt(pool, 0)?.ad.id));
    check('ad: an offset lands mid-ad, so a late tuner seeks in',
      _test.adAt(pool, 6)?.offset === 6, JSON.stringify(_test.adAt(pool, 6)));
    check('ad: the next ad starts when the previous one really ends',
      _test.adAt(pool, 14)?.ad.id === 'ad1' && _test.adAt(pool, 14)?.offset === 0, JSON.stringify(_test.adAt(pool, 14)));

    // A weekly film: the reels that cross midnight belong to the NEXT weekday, or the
    // back half of a Saturday-night picture airs on Saturday morning instead.
    const SAT = 6, SUN = 7;
    const bit = d => 1 << (d - 1);
    check('film: the first reel airs on the screening night',
      A.filmDayMask([SAT], 0) === bit(SAT), String(A.filmDayMask([SAT], 0)));
    check('film: a reel past midnight rolls onto the next day',
      A.filmDayMask([SAT], 1) === bit(SUN), String(A.filmDayMask([SAT], 1)));
    check('film: the day-of-week wraps at Sunday',
      A.filmDayMask([SUN], 1) === bit(1), String(A.filmDayMask([SUN], 1)));
    check('film: no @airday means every day, as the schedule always defaulted',
      A.filmDayMask(null, 0) === 127 && A.filmDayMask([], 2) === 127, 'default mask');

    // A row with no stamp — a slot hand-placed on the dev panel timeline rather than
    // pinned by ensureFilmSlots — falls back to its own start, which is right for one slot.
    const solo = { broadcastId: 'g', startTime: 9 * 3600, duration: BLOCK };
    check('film: an unstamped slot falls back to its own start (hand-placed rows)',
      A.filmRunElapsed(solo, 9 * 3600 + 120) === 120, String(A.filmRunElapsed(solo, 9 * 3600 + 120)));

    // The matte holds no airtime, so the seeker walks past it — but it has to be
    // REMEMBERED, or a late viewer (nearly every viewer of a 175-minute picture)
    // watches the film unframed.
    {
      const g = {
        _start: 'start',
        nodes: {
          start: { type: 'start', data: {} },
          lb:    { type: 'overlay', data: { overlayType: 'letterbox', on: true, duration_s: 0 } },
          l1:    { type: 'say', data: { text: 'x'.repeat(36), style: 'verbatim' } },
          l2:    { type: 'say', data: { text: 'y'.repeat(36), style: 'verbatim' } },
        },
        edges: [
          { fromNode: 'start', fromPort: 'next', toNode: 'lb' },
          { fromNode: 'lb',    fromPort: 'next', toNode: 'l1' },
          { fromNode: 'l1',    fromPort: 'next', toNode: 'l2' },
        ],
        _normalized: true,
      };
      const bb = {};
      // Holds are quantized up to the broadcast tick grid before being consumed, so one
      // full line is ceil(hold / 1000) * 1000 — seek just past it and we should be on l2.
      const oneLine = Math.ceil(A.nodeHoldMs(g.nodes.l1) / 1000) * 1000;
      A.seekGraph(g, bb, oneLine + 10, 0);
      check('film: seeking past the matte remembers it', bb.pendingLetterbox === true, String(bb.pendingLetterbox));
      check('film: the matte costs the seek no airtime', bb.currentNode === 'l2', String(bb.currentNode));
    }

    check('film: an act card holds its authored duration',
      A.nodeHoldMs({ type: 'overlay', data: { overlayType: 'act_card', duration_s: 8 } }) === 8000, 'act card');
  }


  // ── Weekday overrides on one schedule ───────────────────────────────────────
  // The whole point of the `days` mask: an author lays down ONE grid that repeats
  // all week, then drops day-restricted slots over the top. The runner must always
  // pick the most specific slot covering the current second, so the override wins
  // on its day and the base grid is untouched on the other six.
  {
    const P = _test.pickDailySlot;
    const base = { broadcastId: 'bc_base', startTime: 20 * 3600, duration: 3600, days: 127, priority: 0 };
    const thu  = { broadcastId: 'bc_thu',  startTime: 20 * 3600, duration: 3600, days: 1 << 3, priority: 0 };
    const list = [base, thu];

    check('days: an unset mask reads as every day', _test.dayMask(undefined) === 127, String(_test.dayMask(undefined)));
    check('days: a zero mask can never black out a slot', _test.dayMask(0) === 127, String(_test.dayMask(0)));
    check('days: the every-day mask has no label', _test.dayLabel(127) === '', _test.dayLabel(127));
    check('days: a restricted mask labels its days', _test.dayLabel((1 << 3) | (1 << 6)) === 'Thu,Sun', _test.dayLabel((1 << 3) | (1 << 6)));

    check('days: the Thursday slot wins on Thursday',  P(list, 20 * 3600 + 60, 4)?.broadcastId === 'bc_thu',  String(P(list, 20 * 3600 + 60, 4)?.broadcastId));
    check('days: the base grid still plays Wednesday', P(list, 20 * 3600 + 60, 3)?.broadcastId === 'bc_base', String(P(list, 20 * 3600 + 60, 3)?.broadcastId));
    check('days: the base grid still plays Sunday',    P(list, 20 * 3600 + 60, 7)?.broadcastId === 'bc_base', String(P(list, 20 * 3600 + 60, 7)?.broadcastId));
    check('days: nothing airs outside the window',     P(list, 19 * 3600, 4) === null, String(P(list, 19 * 3600, 4)));

    // Specificity, not authoring order: the same pair in either order resolves the same.
    check('days: order of rows never decides the winner',
      P([thu, base], 20 * 3600 + 60, 4)?.broadcastId === 'bc_thu', 'reversed');

    // A weekend slot (2 days) beats the everyday grid (7) but loses to a Saturday-only
    // slot (1) — so overrides can be layered coarse-to-fine.
    const wknd = { broadcastId: 'bc_wknd', startTime: 20 * 3600, duration: 3600, days: (1 << 5) | (1 << 6), priority: 0 };
    const sat  = { broadcastId: 'bc_sat',  startTime: 20 * 3600, duration: 3600, days: 1 << 5, priority: 0 };
    check('days: fewer days beats more days',
      P([base, wknd, sat], 20 * 3600 + 60, 6)?.broadcastId === 'bc_sat', String(P([base, wknd, sat], 20 * 3600 + 60, 6)?.broadcastId));
    check('days: the weekend slot still wins on Sunday',
      P([base, wknd, sat], 20 * 3600 + 60, 7)?.broadcastId === 'bc_wknd', String(P([base, wknd, sat], 20 * 3600 + 60, 7)?.broadcastId));

    // priority is the manual escape hatch and outranks specificity.
    const forced = { broadcastId: 'bc_forced', startTime: 20 * 3600, duration: 3600, days: 127, priority: 5 };
    check('days: priority outranks specificity',
      P([thu, forced], 20 * 3600 + 60, 4)?.broadcastId === 'bc_forced', String(P([thu, forced], 20 * 3600 + 60, 4)?.broadcastId));

    check('days: slotAirsOn respects the mask',
      _test.slotAirsOn(thu, 4) === true && _test.slotAirsOn(thu, 5) === false, 'mask');
  }

  // ── The guide names the sport that is actually on ───────────────────────────
  // KSAB carries both leagues in the SAME 18:00 window on different nights. The
  // schedule always resolved that correctly, but every surface that DESCRIBED the
  // slot had the word DEADBALL and Deadball's season written into it, so a Cluster
  // Puck night was listed as a ballgame — with hockey clubs in the matchup, which is
  // what made it read as the guide and the set disagreeing. A label built from the
  // item's own script can't drift from what the runner picked.
  {
    const L = _test.sportsSlotLabel;
    const mkItem = (sport) => ({
      playback_mode: 'sports',
      broadcastName: sport === 'hockey' ? 'Cluster Puck — CPhL Coldwater Hockey' : 'Deadball — Coldwater League Baseball',
      sportsScript: {
        sport,
        title: sport === 'hockey' ? 'CLUSTER PUCK' : 'DEADBALL',
        airSlots: [6],
        teams: ['Wardens', 'Benders', 'Wolves', 'Mudhens', 'Kings', 'Ravens', 'Hounds', 'Saints'],
      },
    });

    // PIN THE SEASON PHASE. `sportsSlotLabel` takes a final's branch when one
    // is pending — correct behaviour, but it made these assertions depend on
    // whatever phase the dev DB was sitting in. Booting the server once advanced
    // baseball into `worldseries` and turned this suite red for a reason that had
    // nothing to do with the code. Both branches are now asserted deliberately.
    const caches = _test.seasonCaches;
    const saved = new Map(caches);
    const setPhase = (sport, season) => caches.set(sport, season);
    try {
      setPhase('baseball', { phase: 'regular', finalistA: null, finalistB: null });
      setPhase('hockey', { phase: 'regular', finalistA: null, finalistB: null });

      // Each sport is captioned from a slot it plays in: on the slate the other sport's
      // slots have no game of its own to name.
      const teams8 = mkItem('hockey').sportsScript.teams;
      const slotFor = (sport) => { for (let s = 40000; s < 40100; s++) if (_test.sportsMatchupForSlot(s, teams8, sport)) return s; return null; };
      const puck = L(mkItem('hockey'), slotFor('hockey'));
      const ball = L(mkItem('baseball'), slotFor('baseball'));
      check('guide: a hockey slot is captioned CLUSTER PUCK, never DEADBALL',
        /^CLUSTER PUCK: /.test(puck || '') && !/DEADBALL/.test(puck || ''), String(puck));
      check('guide: a baseball slot is still captioned DEADBALL',
        /^DEADBALL: /.test(ball || ''), String(ball));

      // …and the branch that used to break it, now asserted on purpose: a pending
      // final outranks the regular caption, per sport, without leaking across.
      setPhase('baseball', { phase: 'worldseries', finalistA: 'Static Saints', finalistB: 'Bunker Hill Bruisers' });
      const wsBall = L(mkItem('baseball'), slotFor('baseball'));
      check('guide: a pending Curtain Call outranks the DEADBALL caption',
        /CURTAIN CALL: Static Saints vs Bunker Hill Bruisers/.test(wsBall || ''), String(wsBall));
      check('guide: …and a baseball final never re-captions the hockey slot',
        /^CLUSTER PUCK: /.test(L(mkItem('hockey'), slotFor('hockey')) || ''), String(L(mkItem('hockey'), slotFor('hockey'))));
    } finally {
      caches.clear();
      for (const [k, v] of saved) caches.set(k, v);
    }
    check('guide: a non-sports row has no sports label', L({ playback_mode: 'film' }) === null, 'film');

    // ── The log rung's overlays ───────────────────────────────────────────────
    // A viewer on the bottom Display Mode rung has no panel to take a score bug,
    // and the score is the one thing a viewer is actually tracking — it should not
    // have to be inferred from a play-by-play line you may have missed.
    {
      const bug = {
        overlayType: 'scorebug', sport: 'baseball',
        away: 'Static Saints', home: 'Meltdown Mudhens', awayAbbr: 'SAI', homeAbbr: 'MUD',
        awayScore: 3, homeScore: 5, status: 'TOP 7th', outs: 2,
      };
      const line = _test.scorebugLine(bug);
      check('scorebug line carries both scores', /3/.test(line) && /5/.test(line), line);
      check('…and both clubs', /SAI/.test(line) && /MUD/.test(line), line);
      check('…and the state of play', /TOP 7th/.test(line) && /2 out/.test(line), line);
      check('no bug renders nothing at all', _test.scorebugLine(null) === null);
      // Abbreviations are optional on the payload; fall back to the full name
      // rather than rendering an empty side.
      const noAbbr = _test.scorebugLine({ away: 'Saints', home: 'Mudhens', awayScore: 0, homeScore: 0, status: 'PRE' });
      check('…falling back to full club names when no abbreviation is given',
        /Saints/.test(noAbbr) && /Mudhens/.test(noAbbr), noAbbr);

      const table = _test.standingsLines({ title: 'LEAGUE', rows: [{ team: 'Saints', record: '9-2' }, { team: 'Mudhens', record: '7-4' }] });
      check('standings render as a table with records', /Saints/.test(table) && /9-2/.test(table), table);
      check('empty standings render nothing rather than a bare heading',
        _test.standingsLines({ title: 'LEAGUE', rows: [] }) === null);
      check('a missing standings overlay renders nothing', _test.standingsLines(null) === null);
    }

    // The dedicated-channel nightly guide reads the same brand off the same script.
    const rows = _test.sportsScheduleSlots(mkItem('hockey').sportsScript, _test.sportsSlotIndex());
    check('guide: the nightly sports listing brands each row by its own sport',
      Array.isArray(rows) && rows.length > 0 && rows.every(r => !/DEADBALL/.test(r.name)),
      JSON.stringify((rows || []).map(r => r.name)));
  }

  // ── CLUSTER PUCK (CPhL hockey) ──────────────────────────────────────────────
  // The hockey sim, its narrator and the rink view are bound by invariants that
  // nothing else in the suite can catch, because they span three files and a content
  // script: the sim must emit a beat for every pool, the narrator must fill every
  // token, and — the load-bearing one — a GOAL's possession keyframes must finish
  // PAST the goal line the rink view draws, or the puck never visibly goes in.
  //
  // This deliberately reads the real data/scripts/hockey.bsm rather than a fixture.
  // The line library IS content; a fixture would pass forever while the shipped show
  // quietly lost a pool.
  {
    const { HOCKEY, rosterFor } = await import('./sports/hockey.js');
    const { finalPackage: finalPkg } = await import('./sports/final-package.js');
    const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('./rng.js');
    const { __test: RINK } = await import('../../client/game/js/panels/gameday-rink.js');
    const fs = await import('fs');
    const url = await import('url');

    const bsmPath = url.fileURLToPath(new URL('../../data/scripts/hockey.bsm', import.meta.url));
    const src = fs.readFileSync(bsmPath, 'utf8');
    const block = (k) => {
      const seg = src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '';
      return seg.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => s.replace(/"/g, ''));
    };
    const pools = {};
    { let key = null;
      for (const raw of src.split(/\r?\n/)) {
        const l = raw.trim();
        if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; }
        if (l.startsWith('::')) { key = null; continue; }
        if (key && l && !l.startsWith('#')) pools[key].push(l);
      } }
    const teams = block('teams'), players = block('players');

    check('hockey: the script still parses', teams.length >= 2 && players.length > 0 && Object.keys(pools).length > 10,
      `teams=${teams.length} players=${players.length} pools=${Object.keys(pools).length}`);

    // ── club identities: content dresses every club ───────────────────────────
    // The look of a club (colours, kits, crest) is authored into the broadcast row by
    // scripts/content/build-cphl-clubs.mjs. A club in the .bsm with no identity would
    // play in hashed colours with no crest, and nothing else would notice.
    {
      const row = JSON.parse(fs.readFileSync(url.fileURLToPath(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url)), 'utf8'));
      const idents = row.sports_pools?.clubs || {};
      check('hockey: the row carries the .bsm league', JSON.stringify(row.sports_pools?.teams) === JSON.stringify(teams), (row.sports_pools?.teams || []).join(','));
      check('hockey: every club has an identity', teams.every(t => idents[t]), teams.filter(t => !idents[t]).join(','));
      const HEX = /^#[0-9a-f]{6}$/i;
      const badKit = [];
      for (const t of teams) for (const side of ['home', 'road']) {
        const k = idents[t]?.kit?.[side];
        if (!k) { badKit.push(`${t} ${side}: none`); continue; }
        for (const f of ['jersey', 'trim', 'pants', 'sock', 'glove', 'helmet']) if (!HEX.test(k[f] || '')) badKit.push(`${t} ${side}.${f}`);
        for (const b of [...(k.hem || []), ...(k.sleeve || []), ...(k.socks || [])]) if (!HEX.test(b.col || '') || (b.alt && !HEX.test(b.alt))) badKit.push(`${t} ${side} band`);
      }
      check('hockey: every kit is in hex (figure.js shades with parseInt)', badKit.length === 0, badKit.slice(0, 4).join(', '));
      const badCrest = teams.filter(t => !(idents[t]?.crest?.layers?.length && idents[t]?.crest?.small?.length));
      check('hockey: every club has a crest and a small crest', badCrest.length === 0, badCrest.join(','));
      // A keeper's mask is art in the mask's own flattening (gl/arena.js paints it into a cell
      // of its texture; the 2-D figure uses base/trim/edge). A path that doesn't parse paints
      // nothing and throws nowhere, so the paths are checked for what Path2D reads.
      const PATH = /^(?:[MLQCZa]|-?\d*\.?\d+(?:e-?\d+)?|[\s,])+$/;
      const badMask = [];
      for (const t of teams) {
        const m = idents[t]?.mask;
        if (!m) { badMask.push(`${t}: none`); continue; }
        if (!(m.w > 0 && m.h > 0)) badMask.push(`${t}: box`);
        for (const f of ['base', 'trim', 'edge']) if (!HEX.test(m[f] || '')) badMask.push(`${t}.${f}`);
        const bad = (m.layers || []).filter(l => !(typeof l.d === 'string' && PATH.test(l.d) && (l.fill === 'none' || l.fill === 'sett' || HEX.test(l.fill || '')) && (!l.stroke || HEX.test(l.stroke))));
        if (!m.layers?.length || bad.length) badMask.push(`${t}: ${bad.length} of ${m.layers?.length || 0} layers`);
        const n = m.number;
        if (n && !(Array.isArray(n.at) && n.at.length === 2 && n.at.every(Number.isFinite) && n.size > 0 && HEX.test(n.fill || '') && HEX.test(n.edge || ''))) badMask.push(`${t}: number`);
      }
      check("hockey: every keeper's mask is in hex, with paths that parse", badMask.length === 0, badMask.slice(0, 4).join(', '));
      // no faction teams: no club is named for one of the orders
      const orders = fs.readdirSync(url.fileURLToPath(new URL('../../content/orgs/', import.meta.url))).filter(f => f.startsWith('ideology_')).map(f => f.slice(9, -5).replace(/_/g, ''));
      const factional = teams.filter(t => orders.some(o => t.toLowerCase().replace(/[^a-z]/g, '').includes(o)));
      check('hockey: no club is named for an order', factional.length === 0, factional.join(','));
    }

    // ── how the booth speaks: its own voice, and the names said right ─────────
    // The script's ::say block (pronunciations for names no dictionary has) and @voice
    // ride every spoken line to the client, each line with only the entries it uses.
    // The row is what ships, so it must agree with the script, and the real assembler
    // must put them on the nodes, or the booth falls back to the letter-guesser and the
    // station's ringing voice without anything failing.
    {
      const row = JSON.parse(fs.readFileSync(url.fileURLToPath(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url)), 'utf8'));
      const sayBsm = Object.fromEntries(block('say').map(l => { const m = /^(\S+)\s+(.+)$/.exec(l); return m ? [m[1].toLowerCase(), m[2].replace(/\s+/g, ' ')] : null; }).filter(Boolean));
      const voiceLine = (src.split(/\r?\n/).find(l => l.startsWith('@voice ')) || '').slice(7).trim();
      const voiceBsm = Object.fromEntries(voiceLine.split(/\s+/).filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, +v]; }));
      check('hockey: the row carries the script\'s pronunciations', JSON.stringify(row.sports_pools?.say) === JSON.stringify(sayBsm), `${Object.keys(row.sports_pools?.say || {}).length} vs ${Object.keys(sayBsm).length}`);
      check('hockey: the row carries the script\'s booth voice', JSON.stringify(row.sports_pools?.voice) === JSON.stringify(voiceBsm), JSON.stringify(row.sports_pools?.voice));
      // vs=1: "{away}–{home}" is said "away versus home", not "away, home" (readMatchups)
      check('hockey: the booth reads a matchup as versus', voiceBsm.vs === 1, voiceLine);
      const script = row.sports_pools, wrong = [];
      let withLex = 0, sayNodes = 0, voiced = 0, spoken = 0;
      const colourLines = [];
      for (const slot of [3, 42, 206]) {   // hockey's slots on the slate
        const graph = _test.assembleSportsGraph(script, 'bc_regress_cphl', slot, null);
        for (const n of Object.values(graph.nodes || {})) {
          if (n.type !== 'say' || !n.data?.text) continue;
          sayNodes++;
          if (JSON.stringify(n.data.voice) === JSON.stringify(script.voice)) voiced++;
          if (n.data.speaker === script.announcer) spoken++;
          if (script.analyst && n.data.text.startsWith(script.analyst + ' says, "')) colourLines.push(n.data.text);
          const words = new Set((n.data.text.toLowerCase().match(/[a-z][a-z'-]*/g) || []).map(w => w.replace(/'s$/, '')));
          const want = [...words].filter(w => script.say[w]);
          const got = Object.keys(n.data.lex || {});
          if (got.length) withLex++;
          if (want.some(w => n.data.lex?.[w] !== script.say[w]) || got.some(w => !words.has(w))) wrong.push(n.data.text);
        }
      }
      check('hockey: every line carries the booth voice', sayNodes > 100 && voiced === sayNodes, `${voiced} of ${sayNodes}`);
      // the play-by-play man is named on every line, so the TV voices him and tags his caption
      check('hockey: every line names who is on the mic', spoken === sayNodes, `${spoken} of ${sayNodes}`);
      // the colour man (@analyst) talks, tagged by name, and never says the same line twice a game
      check('hockey: the colour man has his say, by name', !!script.analyst && colourLines.length >= 3, `${colourLines.length}: ${colourLines.slice(0, 2).join(' | ')}`);
      check('hockey: the colour man fills every token', colourLines.every(l => !/\{\w+\}/.test(l)), colourLines.filter(l => /\{\w+\}/.test(l)).slice(0, 2).join(' | '));
      check('hockey: a line naming a ::say word carries its pronunciation, and only what it uses', withLex > 0 && wrong.length === 0, `${withLex} with lex; wrong: ${wrong.slice(0, 2).join(' | ')}`);
      const { holdFor } = await import('./sports/hockey-pacing.js');
      check('hockey: a drawn-out call holds longer on air', holdFor('He SCOOOOOOORES!!!') >= holdFor('He SCORES!') + 500, `${holdFor('He SCOOOOOOORES!!!')} vs ${holdFor('He SCORES!')}`);
    }

    // ── rosters: a man belongs to ONE club ────────────────────────────────────
    check('hockey: the pool covers every club', players.length >= teams.length * 6,
      `${players.length} names for ${teams.length} clubs (need ${teams.length * 6})`);
    const clubOf = new Map();
    let shared = 0;
    for (const t of teams) for (const n of rosterFor(t, teams, players)) { if (clubOf.has(n)) shared++; clubOf.set(n, t); }
    check('hockey: no skater plays for two clubs', shared === 0, `${shared} shared`);
    check('hockey: every club ices six', clubOf.size === teams.length * 6, `${clubOf.size} men dealt`);
    const r1 = rosterFor(teams[2], teams, players);
    check('hockey: a roster is stable across calls', JSON.stringify(r1) === JSON.stringify(rosterFor(teams[2], teams, players)), r1.join(','));
    check('hockey: a roster ignores club order', JSON.stringify(r1) === JSON.stringify(rosterFor(teams[2], [...teams].reverse(), players)), 'order');

    // ── the sim + the narrator over a real slate ──────────────────────────────
    const seenTypes = new Set(), usedPools = new Set();
    const unfilled = [], strayScorers = [], notCrossed = [];
    const gdViolent = new Set();
    let goals = 0, faceoffs = 0, centreDrops = 0, periods = 0, lines = 0, gamesPlayed = 0, sold = 0;
    // A WIDE SLATE, because one of the things asserted below is RARE. A death needs a
    // game tied after regulation AND an overtime fatal roll, which is a compound tail —
    // at 24 games it appeared or didn't depending on the seed, so any change that
    // shifted the RNG stream (moving one `rand()` call in the sim) could turn the death
    // assertion red without anything being broken. The sample is the fix: the check is
    // "the sim can still produce one and it reaches the ice", and that needs enough
    // games for "can" to be a fair question.
    for (let slot = 0; slot < 64; slot++) {
      const seed = sportsHash(slot, 0);
      const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
      if (matchup.away === matchup.home) continue;
      const game = HOCKEY.simGame(matchup, players, sportsRng(seed));
      gamesPlayed++;
      for (const b of game.beats) {
        seenTypes.add(b.type);
        if (b.type === 'goal') goals++;
        if (b.type === 'period_start') periods++;
        if (b.type === 'faceoff') { faceoffs++; if (b.dot === 'C') centreDrops++; }
      }
      // Every scorer must belong to one of the two clubs that actually played.
      for (const s of game.scorers) { const home = clubOf.get(s.name); if (home !== matchup.away && home !== matchup.home) strayScorers.push(s.name); }

      const nrng = sportsRng(seed ^ 0x9e3779b9);
      const pick = (...keys) => { for (const k of keys) if (pools[k]?.length) { usedPools.add(k); break; } return sportsPick(pools, nrng, ...keys); };
      const say = (line, tok, sb, graphic, gd, meta) => {
        if (!line) return;
        lines++;
        if (meta && Number.isFinite(meta.excite)) sold++;
        const text = sportsFill(line, tok).trim();
        // A token the call didn't supply is blanked, not left in braces, so look for what
        // it leaves behind too: "from , and" on a solo goal, "Cordero ." with no {where}.
        if (/\{[a-zA-Z]/.test(text) || /\s[.,!?;:]|\s{2,}/.test(text)) unfilled.push(text);
        if (!gd) return;
        // THE INVARIANT. The rink draws a goal line; the sim decides where the puck
        // finishes. A goal whose last keyframe stops short of that line renders as a
        // shot that mysteriously counts.
        if (gd.type === 'goal' && Array.isArray(gd.possession)) {
          const x = gd.possession[gd.possession.length - 1].p[0];
          const past = x > 0.5 ? x > RINK.GEO.goalLine[1] : x < RINK.GEO.goalLine[0];
          if (!past) notCrossed.push(x.toFixed(3));
        }
        if (gd.type === 'faceoff' && !RINK.DOTS[gd.dot]) unfilled.push(`bad dot ${gd.dot}`);
        if ((gd.type === 'chance' || gd.type === 'goal') && !RINK.SAVE[gd.kind]) unfilled.push(`no SAVE pose for ${gd.kind}`);
        // THE VIOLENCE REACHES THE ICE. This league's character is that men are carried
        // off and occasionally killed, and every one of those calls used to arrive at
        // the rink as nothing at all — the announcer describing a body going through
        // the glass over a still picture. A violent beat has to carry a payload, and
        // that payload has to name a victim and the SIDE he plays for, or the view
        // cannot put the right sweater on the boards.
        if (['boards', 'injury', 'death'].includes(gd.type)) {
          gdViolent.add(gd.type);
          if (!gd.victim) unfilled.push(`${gd.type} names no victim`);
          if (gd.victimSide !== 'att' && gd.victimSide !== 'def') unfilled.push(`${gd.type} victim on no side`);
        }
        if (gd.type === 'scrum') gdViolent.add('scrum');
      };
      HOCKEY.narrate({
        script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan',
        pools, nrng, sport: HOCKEY, add: () => {}, say, pick,
        // ALTERNATE having a record and not. `matchup` and `matchup.records` are two
        // halves of one choice — the announcer works a club's record in only once
        // there is one — so a fixed stub can only ever reach one of them, and the
        // other reads as dead content when it isn't.
        abbr: (n) => String(n).slice(0, 3).toUpperCase(),
        recordOf: () => (slot % 2 ? '8-4-1' : '0-0-0'),
        lastId: () => null,
      });
    }

    // v5: open-ice cross-checks and slashes, some called and some not. Each reaches the ice
    // with a victim on a side, a called one is followed by its penalty, and the booth has a
    // line for every one.
    {
      const seen = { crosscheck: 0, called: 0, caught: 0, missed: 0 }, bad = [];
      for (let slot = 0; slot < 40; slot++) {
        const seed = sportsHash(slot, 5);
        const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
        if (matchup.away === matchup.home) continue;
        const game = HOCKEY.simGame(matchup, players, sportsRng(seed), { version: 5 });
        game.beats.forEach((b, i) => {
          if (b.type === 'boards' && b.hitStyle === 'crosscheck') { seen.crosscheck++; if (b.called) seen.called++; }
          if (b.type === 'slash') seen[b.caught ? 'caught' : 'missed']++;
          const called = (b.type === 'slash' && b.caught) || (b.type === 'boards' && b.called);
          if (called && !game.beats.slice(i + 1, i + 4).some((n) => n.type === 'penalty' && n.player === b.hitter)) bad.push(`${b.type} ${b.hitter} called, no penalty`);
        });
        const nrng = sportsRng(seed ^ 0x51a5);
        HOCKEY.narrate({
          script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
          pick: (...keys) => { for (const k of keys) if (pools[k]?.length) { usedPools.add(k); break; } return sportsPick(pools, nrng, ...keys); },
          say: (line, tok, sb, graphic, gd) => {
            if (line && /\{\w+\}/.test(sportsFill(line, tok))) bad.push(`unfilled: ${line}`);
            if (gd && gd.type === 'slash' && (!gd.victim || !gd.hitter || (gd.victimSide !== 'att' && gd.victimSide !== 'def'))) bad.push('slash payload names nobody');
          },
          abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '0-0-0', lastId: () => null,
        });
      }
      check('hockey v5: cross-checks and slashes happen, called and not', seen.crosscheck > 0 && seen.called > 0 && seen.caught > 0 && seen.missed > 0, JSON.stringify(seen));
      check('hockey v5: a called one goes to the box, and every line fills', bad.length === 0, bad.slice(0, 3).join(' | '));
      check('hockey v5: the booth has the lines', ['boards.crosscheck', 'pbp.hit.carry.open', 'pbp.slash', 'pbp.slash.missed'].every((k) => pools[k]?.length), '');
    }

    check('hockey: goals cross the goal line', notCrossed.length === 0, `${notCrossed.length} short: ${notCrossed.slice(0, 3).join(',')}`);
    check('hockey: no unfilled tokens reach the air', unfilled.length === 0, unfilled.slice(0, 3).join(' | '));
    // How hard each line is sold rides on it, off the pool it came from (exciteOf in
    // hockey-narrator.js), and the voice reads it. A line with none is spoken flat.
    {
      const { exciteOf } = await import('./sports/hockey-narrator.js');
      check('hockey: nearly every line carries a delivery', sold / Math.max(1, lines) > 0.9, `${sold} of ${lines}`);
      check('hockey: a goal is sold hardest, a death low, chatter flat',
        exciteOf('pbp.goal') === 1 && exciteOf('pbp.death.still') < 0 && exciteOf('chatter.yard') === 0 && exciteOf('pbp.shot.slap') === exciteOf('pbp.shot'),
        `${exciteOf('pbp.goal')} ${exciteOf('pbp.death.still')} ${exciteOf('chatter.yard')} ${exciteOf('pbp.shot.slap')}`);
      check('hockey: overtime lifts the play and never the grief', exciteOf('pbp.shot', 0.12) > exciteOf('pbp.shot') && exciteOf('death', 0.12) === exciteOf('death') && exciteOf('pbp.goal', 0.2) === 1);
      // {where} is said from the carrier's side: left and right as he skates, so the same
      // spot is his left going one way and his right coming back.
      const at = (p, plus) => HOCKEY.rinkSpot(p, plus).at;
      check('hockey: the booth places a man where the rink has him',
        at([0.85, 0.5], true) === 'in the slot' && at([0.15, 0.5], false) === 'in the slot'
        && at([0.5, 0.15], true) === 'up the right side' && at([0.5, 0.15], false) === 'up the left side'
        && at([0.97, 0.9], true) === 'in the left corner' && at([0.03, 0.1], false) === 'in the left corner'
        && at([0.66, 0.85], true) === 'at the left point' && at([0.22, 0.5], true) === 'in his own end',
        [at([0.85, 0.5], true), at([0.5, 0.15], false), at([0.03, 0.1], false), at([0.66, 0.85], true)].join(' | '));
    }
    check('hockey: scorers belong to a club that played', strayScorers.length === 0, strayScorers.slice(0, 3).join(','));
    check('hockey: the narrator produced play-by-play', lines > 100, `${lines} lines`);

    // THE CALL. Every play is called in short lines, each held as long as it takes to read,
    // and each tagged with the moment of play it describes so the rink can do it on the
    // line. One real game, paced for an hour slot and for a half-hour one.
    {
      const { paceCalls } = await import('./sports/hockey-pacing.js');
      const slot = 206, seed = sportsHash(slot, 0);
      const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
      const game = HOCKEY.simGame(matchup, players, sportsRng(seed));
      const narrateLines = () => {
        const out = [], nrng = sportsRng(seed ^ 0x9e3779b9);
        HOCKEY.narrate({
          script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
          say: (l, t, sb, fx, gd, meta) => { if (l) out.push({ text: sportsFill(l, t).trim(), bug: sb || null, graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
          pick: (...keys) => { for (const k of keys) if (pools[k]?.length) { usedPools.add(k); break; } return sportsPick(pools, nrng, ...keys); },
          abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
        });
        return out;
      };
      const all = narrateLines();
      const words = all.map((l) => l.text.split(/\s+/).length);
      const shortShare = words.filter((w) => w <= 8).length / words.length;
      check('hockey: most lines are short enough for a screen reader', shortShare >= 0.7, `${Math.round(shortShare * 100)}% at eight words or fewer`);
      check('hockey: every shot is called', game.beats.filter((b) => b.type === 'chance' || b.type === 'goal').length === all.filter((l) => l.gameday && (l.gameday.type === 'chance' || l.gameday.type === 'goal')).length);
      const { holds } = paceCalls(all, 3600 * 1000 * 0.85, 1000);
      const bad = [];
      for (const l of all) {
        const g = l.gameday; if (!g) continue;
        if ((g.type === 'chance' || g.type === 'goal') && !(g.cues || []).some((c) => c.ev === 'shot')) bad.push(`${g.type} ${g.clock} has no shot cue`);
        const ms = (g.cues || []).map((c) => c.ms);
        if (ms.some((m, i) => i && m < ms[i - 1])) bad.push(`${g.type} ${g.clock} cues out of order`);
      }
      check('hockey: shots carry their cues, in order', bad.length === 0, bad.slice(0, 3).join(' | '));
      // The bug doesn't call a goal early: the rush and the shot show the score before the
      // goal, and the goal call shows the new one.
      const early = [];
      let goalGd = null;
      for (const l of all) {
        if (l.gameday && l.gameday.type === 'goal') goalGd = l.gameday;
        if (!goalGd) continue;
        const scored = (l._cue || {}).ev === 'out';
        const want = scored ? { away: goalGd.awayScore, home: goalGd.homeScore } : goalGd.scoreBefore;
        if (!want || !l.bug || l.bug.awayScore !== want.away || l.bug.homeScore !== want.home) early.push(`${goalGd.clock} "${l.text}" shows ${l.bug ? `${l.bug.awayScore}-${l.bug.homeScore}` : 'no bug'}`);
        if (scored) goalGd = null;
      }
      check('hockey: the score bug never calls a goal before it goes in', early.length === 0 && game.beats.some((b) => b.type === 'goal'), early.slice(0, 3).join(' | '));
      const air = [...holds.values()].reduce((a, b) => a + b, 0);
      check('hockey: an hour slot holds the whole game', air <= 3600 * 1000 * 0.85 * 1.05, `${(air / 60000).toFixed(1)} min`);
      const half = narrateLines();
      const short = paceCalls(half, 1800 * 1000 * 0.85, 1000);
      const kept = half.filter((l) => !short.dropped.has(l));
      check('hockey: a short slot cuts only optional lines', short.dropped.size > 0 && [...short.dropped].every((l) => l._opt && !l.gameday) && kept.every((l) => short.holds.get(l) >= 1000), `${short.dropped.size} cut`);
      // colour goes before any call of the play: no optional call is cut while a colour line airs
      const colourKept = kept.some((l) => l._opt === 'colour'), callCut = [...short.dropped].some((l) => l._opt !== 'colour');
      check('hockey: a short slot cuts colour before calls', !(colourKept && callCut), `colour kept ${colourKept}, a call cut ${callCut}`);
      // the moments the rink plays out are called: the drop of every draw, where a saved
      // puck went, the clinch and the box in a fight, what a hit did to the glass
      const has = (re) => all.some((l) => re.test(l.text));
      check('hockey: the booth calls what the rink shows after the play', all.filter((l) => (l._cue || {}).ev === 'drop').length >= 30 && all.some((l) => (l._cue || {}).ev === 'grab') && all.some((l) => (l._cue || {}).ev === 'box'), 'drop, grab and box calls');
      const shatters = all.filter((l) => l.gameday && l.gameday.shatter).length;
      check('hockey: a called shatter rides the hit it happens on', shatters === 0 || has(/glass|pane/i), `${shatters} shatters`);
    }
    // Every violent beat reaches the rink with something to draw. Before this the ice
    // sat still through the half of the sport the league is actually known for.
    for (const t of ['boards', 'injury', 'death', 'scrum']) {
      check(`hockey: a "${t}" reaches the ice, not just the air`, gdViolent.has(t), [...gdViolent].join(',') || 'none');
    }

    // TEXT PARITY. Every beat the sim can emit must be narratable, and every pool the
    // script ships must be reachable — the two halves of "nothing exists only as an
    // animation". `faceoff` is the deliberate fallback behind the three dot-specific
    // pools, so it is expected never to be reached.
    for (const t of ['goal', 'chance', 'faceoff', 'penalty', 'fight', 'boards', 'injury', 'period_start', 'period_end', 'pull', 'scrum', 'hattrick', 'final']) {
      check(`hockey: the sim emits "${t}"`, seenTypes.has(t), [...seenTypes].join(','));
    }
    // The RARE paths — overtime, the shootout, a death on the ice, the Cup — are the
    // ones most likely to rot unnoticed, because an ordinary slate never reaches them.
    // Exempting them from the reachability check would have made this assertion a
    // comfortable lie, so instead they are hunted for and narrated on purpose.
    const narrateSlot = (slot, opts = {}) => {
      const seed = sportsHash(slot, opts.ws ? 0x77 : 0);
      const matchup = opts.matchup || { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
      if (matchup.away === matchup.home) return null;
      // Forward the ledger, so a caller can narrate a depleted club and reach the
      // injury-report pool that a healthy slate never touches.
      // And the sim version, so a v2 death reaches the vat's lines.
      const game = HOCKEY.simGame(matchup, players, sportsRng(seed),
        { ...(opts.unavailable ? { unavailable: opts.unavailable } : {}), ...(opts.version ? { version: opts.version } : {}), ...(opts.important ? { important: true } : {}) });
      const nrng = sportsRng(seed ^ 0x9e3779b9);
      const pick = (...keys) => { for (const k of keys) if (pools[k]?.length) { usedPools.add(k); break; } return sportsPick(pools, nrng, ...keys); };
      const say = (l, t) => { if (l) { const x = sportsFill(l, t).trim(); if (/\{[a-zA-Z]/.test(x) || /\s[.,!?;:]|\s{2,}/.test(x)) unfilled.push(x); } };
      // The Cup's package, read for real (sports/final-package.js) over three made-up seasons, so
      // the series is led, level and never played, and a club has two men to watch, one, and men out.
      const finalPackage = (prefix) => {
        const [a, b] = [game.away.name, game.home.name];
        for (const results of [[{ a, h: b, as: 3, hs: 1 }], [{ a, h: b, as: 3, hs: 1 }, { a: b, h: a, as: 2, hs: 0 }], []]) {
          const pk = finalPkg({ sport: 'hockey', final: 'Coldwater Cup', away: a, home: b, results, rows: [{ team: a, wins: 2, losses: 1, otl: 0, points: 4 }],
            seeds: { away: 1, home: 2 }, watch: { away: [{ name: 'Ace', said: '9 goals' }, { name: 'Keeper', said: '4 wins' }], home: [{ name: 'Solo', said: '3 goals' }] }, out: { home: ['Hurt'] } });
          for (const l of pk.lines) say(pick(prefix + l.key), l.tok);
        }
      };
      HOCKEY.narrate({
        script: {}, game, gs: { seed, game }, slot, ws: !!opts.ws, announcer: 'Tug Brennan', analyst: 'Rennie Gault',
        heard: (k) => usedPools.add(k),
        pools, nrng, sport: HOCKEY, add: () => {}, say, pick,
        abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
        venue: { said: 'Golden Goose Gardens', name: 'Golden Goose Gardens', rev: '' }, xpick: pick, finalPackage,
        vpick: pick, vatBack: opts.vatBack || null, season: opts.season || null, slotsPerDay: 8,
      });
      return game;
    };
    // Hunt a wide slot range for each rare shape and narrate the first of each.
    let sawOt = false, sawSo = false, sawDeath = false;
    for (let slot = 0; slot < 4000 && !(sawOt && sawSo && sawDeath); slot++) {
      const seed = sportsHash(slot, 0);
      const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
      if (matchup.away === matchup.home) continue;
      const g = HOCKEY.simGame(matchup, players, sportsRng(seed));
      const dead = !!g.dead, so = g.beats.some(b => b.type === 'shootout_end');
      const want = (g.overtime && !sawOt) || (so && !sawSo) || (dead && !sawDeath);
      if (!want) continue;
      narrateSlot(slot);
      if (g.overtime) sawOt = true;
      if (so) sawSo = true;
      if (dead) sawDeath = true;
    }
    check('hockey: overtime happens and is narratable', sawOt, 'no OT game found in 4000 slots');
    check('hockey: the shootout happens and is narratable', sawSo, 'no shootout found in 4000 slots');
    check('hockey: a man can die on the ice', sawDeath, 'no fatality found in 4000 slots');
    // Rivalry is asserted DIRECTLY rather than hunted: whether this suite's synthetic
    // pairing (home = 7i+5) ever lands on the league's rivalry pairing depends on how many
    // clubs there are, so waiting for one would only test the arithmetic. Build it instead.
    {
      const { rivalOf } = await import('./sports/hockey.js');
      const rival = rivalOf(teams[0], teams);
      const rg = narrateSlot(5, { matchup: { away: teams[0], home: rival, teams } });
      check('hockey: a known rival pair is flagged as a rivalry', !!rg && rg.rivalry === true, `${teams[0]} vs ${rival}`);
      const ng = narrateSlot(5, { matchup: { away: teams[0], home: teams.find(t => t !== teams[0] && t !== rival), teams } });
      check('hockey: a non-rival pair is not', !!ng && ng.rivalry === false, 'non-rival');
    }
    // A club with men on the shelf — unlocks the injury report and the call-up lines.
    // Without a ledger no game ever dresses a replacement, so the pool would read as
    // dead content when it is simply never reached by a healthy slate.
    {
      const base = rosterFor(teams[0], teams, players);
      narrateSlot(9, { matchup: { away: teams[0], home: teams[1], teams }, unavailable: new Set([base[0], base[2]]) });
    }
    // Every club with authored colour is played at home once, so each chatter.<club> is
    // exercised. The synthetic pairings above don't reach them all.
    const barnKey = (name) => `chatter.${String(name).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    for (const barn of teams.filter(t => pools[barnKey(t)])) {
      narrateSlot(13, { matchup: { away: teams.find(t => t !== barn), home: barn, teams } });
    }
    // The Cup: a final is the same sim with `ws`, which unlocks the cup.* pools.
    narrateSlot(11, { ws: true, matchup: { away: teams[0], home: teams[1], teams } });
    // The vat (sim v2): a death says how long the reprint takes, and a man back from it is
    // named before the drop, once for his first death, once for a second this season and
    // once with deaths in an earlier season.
    for (let slot = 0; slot < 4000; slot++) {
      const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
      if (matchup.away === matchup.home) continue;
      if (!HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)), { version: 2 }).dead) continue;
      narrateSlot(slot, { version: 2 });
      break;
    }
    {
      const man = rosterFor(teams[0], teams, players)[0];
      for (const season of [null, { toll: { [man]: { hurt: 0, died: 2 } } }, { toll: { [man]: { hurt: 0, died: 1 } }, career: { [man]: { hurt: 1, died: 1 } } }]) {
        narrateSlot(15, { matchup: { away: teams[0], home: teams[1], teams }, vatBack: new Set([man]), season });
      }
    }

    // Fights and brawls (sim v3): a brawl only happens between rivals in a game that
    // matters, so play rival finals under v3 until every fight and brawl pool has fired.
    {
      const { rivalOf } = await import('./sports/hockey.js');
      const v3Pools = Object.keys(pools).filter(k => /(^|.)(fight|brawl)(.|$)/.test(k));
      for (let slot = 0; slot < 6000 && v3Pools.some(k => !usedPools.has(k)); slot++) {
        const away = teams[slot % teams.length];
        narrateSlot(slot, { version: 3, important: true, matchup: { away, home: rivalOf(away, teams), teams } });
      }
    }
    // Rebounds and putbacks (sim v6): only v6 leaves a rebound in front for a second shot, so
    // play v6 games until the live-rebound and putback pools have both fired.
    {
      const v6Pools = ['pbp.rebound.live', 'pbp.putback'].filter(k => pools[k]);
      for (let slot = 0; slot < 400 && v6Pools.some(k => !usedPools.has(k)); slot++) narrateSlot(slot, { version: 6 });
    }
    // Now the check has no exemptions but the deliberate `faceoff` fallback, which sits
    // behind the three dot-specific pools and is expected never to fire.
    const unreachable = Object.keys(pools).filter(k => !usedPools.has(k) && k !== 'faceoff');
    check('hockey: every pool is reachable', unreachable.length === 0, unreachable.join(','));
    check('hockey: still no unfilled tokens on the rare paths', unfilled.length === 0, unfilled.slice(0, 3).join(' | '));

    // Rivalries pair the league mutually — a one-way rivalry is a bug you would only
    // ever notice as an announcer contradicting himself two games later.
    {
      const { rivalOf } = await import('./sports/hockey.js');
      const oneWay = teams.filter(t => { const r = rivalOf(t, teams); return r && rivalOf(r, teams) !== t; });
      check('hockey: rivalries are mutual', oneWay.length === 0, oneWay.join(','));
      check('hockey: a club has at most one rival', new Set(teams.map(t => rivalOf(t, teams))).size >= teams.length - 1, 'pairing');
    }

    // ── faceoffs happen where the RULE says ───────────────────────────────────
    // Centre ice is reserved for a goal or the start of a period. Everything else is an
    // end-zone or neutral dot. The shortfall is exactly the games that ENDED on a goal
    // with no drop after it — a sudden-death winner — so the tolerance is ONE PER GAME
    // rather than a constant. It was a flat `- 4`, silently tuned to a 24-game slate,
    // and went red the moment the slate grew and again whenever the RNG stream shifted;
    // a bound that scales with the sample says what it means and stops doing that.
    check('hockey: faceoffs happen at every stoppage', faceoffs > goals + periods, `${faceoffs} draws`);
    check('hockey: centre ice is only after a goal or a period start',
      centreDrops <= goals + periods && centreDrops >= (goals + periods) - gamesPlayed,
      `${centreDrops} centre vs ${goals} goals + ${periods} periods over ${gamesPlayed} games`);

    // ── persistent injuries ───────────────────────────────────────────────────
    // Injuries carrying across games is the one feature that makes a game depend on the
    // games before it — the exact thing this league's determinism forbids. It only works
    // because the ledger is itself a fold over the deterministic schedule, so the thing
    // most worth asserting is that walking the same season twice produces the same
    // season, and that a man who is out really is absent.
    {
      const { reservePool, icedRoster, INJURY_MAX_SLOTS, REPRINT_MAX_SLOTS, healSlot } = await import('./sports/hockey.js');
      const reserve = reservePool(teams, players);
      check("hockey: there's a reserve to call up from", reserve.length > 0, `${reserve.length} spare men`);
      const rostered = new Set();
      for (const t of teams) for (const n of rosterFor(t, teams, players)) rostered.add(n);
      check('hockey: the reserve is nobody\'s first-choice six', reserve.every(n => !rostered.has(n)), 'overlap');

      // A club missing men still ices six, and the replacements are marked.
      const club = teams[0];
      const base = rosterFor(club, teams, players);
      const dressed = icedRoster(club, teams, players, new Set([base[0], base[3]]));
      check('hockey: a depleted club still ices six', dressed.length === 6, String(dressed.length));
      check("hockey: the injured men aren't dressed", !dressed.some(d => d.name === base[0] || d.name === base[3]), dressed.map(d => d.name).join(','));
      check('hockey: their replacements are marked as call-ups', dressed.filter(d => d.callup).length === 2, JSON.stringify(dressed.filter(d => d.callup)));
      check('hockey: a call-up records who he replaces', dressed.filter(d => d.callup).every(d => d.replacing), 'replacing');
      check('hockey: a healthy club dresses no call-ups',
        icedRoster(club, teams, players, new Set()).every(d => !d.callup), 'healthy');

      // Walk a season carrying the ledger, exactly as computeStandings and the air path do.
      const walk = () => {
        const out = new Map(); const scores = []; let callups = 0, peak = 0, everHurt = false;
        for (let slot = 0; slot < 160; slot++) {
          for (const [n, h] of out) if (h <= slot) out.delete(n);
          const un = new Set(out.keys());
          peak = Math.max(peak, un.size);
          const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
          if (matchup.away === matchup.home) continue;
          const g = HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)), { unavailable: un });
          scores.push(`${g.awayScore}-${g.homeScore}`);
          callups += g.callups.length;
          // Nobody on the ledger may appear on the ice.
          for (const s of [...g.away.skaters, ...g.home.skaters]) if (un.has(s.name)) everHurt = true;
          for (const c of g.casualties) {
            const heal = healSlot(c, slot);
            if (heal > (out.get(c.name) || 0)) out.set(c.name, heal);
          }
        }
        return { scores, out, callups, peak, everHurt };
      };
      const a = walk(), b = walk();
      check('hockey: the injury chain is deterministic', JSON.stringify(a.scores) === JSON.stringify(b.scores), 'two walks diverged');
      check('hockey: injuries actually persist', a.callups > 0, `${a.callups} call-ups over 160 slots`);
      check('hockey: an unavailable man never takes the ice', !a.everHurt, 'a hurt man dressed');
      // Balance: an absence only means something while it stays rare.
      check("hockey: the league doesn't saturate with injuries", a.peak <= 40, `peak ${a.peak} of ${teams.length * 6}`);
      const durations = [];
      for (let slot = 0; slot < 200; slot++) {
        const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
        if (matchup.away === matchup.home) continue;
        const g = HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)));
        for (const c of g.casualties) if (!c.dead) durations.push(c.slotsOut);
      }
      check('hockey: an injury carries a duration', durations.length > 0 && durations.every(d => d >= 1 && d <= INJURY_MAX_SLOTS),
        `${durations.length} injuries, max ${Math.max(0, ...durations)}`);

      // ── the vat (sim v2) ──
      // v2 reprints a dead man. Its length is hashed, not drawn from the game's rand, so a
      // v2 game is the v1 game beat for beat; only the death's duration differs.
      {
        let deaths = 0, sameBeats = true, v1Forever = true, v2Timed = true;
        const strip = (g) => JSON.stringify(g.beats.map(({ reprintSlots, ...r }) => r));
        for (let slot = 0; slot < 300 && deaths < 3; slot++) {
          const matchup = { away: teams[slot % teams.length], home: teams[(slot * 3 + 1) % teams.length], teams };
          if (matchup.away === matchup.home) continue;
          const g1 = HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)), { version: 1 });
          const g2 = HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)), { version: 2 });
          if (strip(g1) !== strip(g2) || g1.awayScore !== g2.awayScore || g1.homeScore !== g2.homeScore) sameBeats = false;
          const d1 = g1.casualties.find(c => c.dead), d2 = g2.casualties.find(c => c.dead);
          if (!d1) continue;
          deaths++;
          if (healSlot(d1, slot) !== Number.MAX_SAFE_INTEGER) v1Forever = false;
          const back = healSlot(d2, slot) - slot;
          if (!(back > INJURY_MAX_SLOTS && back <= REPRINT_MAX_SLOTS) || g2.beats.find(b => b.type === 'death')?.reprintSlots !== d2.slotsOut) v2Timed = false;
        }
        check('hockey: the scan found deaths to test the vat on', deaths > 0, `${deaths} deaths`);
        check('hockey: v2 plays every beat as v1 did', sameBeats, 'a v2 game diverged from v1');
        check('hockey: under v1 a death is for the season', v1Forever, 'a v1 death healed');
        check('hockey: under v2 the vat takes longer than any injury, and the beat says how long', v2Timed, 'a reprint out of range');
      }

      // The chain carries the vat: a man who died is out until the vat's slot, then fit,
      // and he's back from the vat until the first game he dresses for.
      {
        const script = { sport: 'hockey', teams, players, pools };
        const S0 = 120000;
        const savedSwitch = _test.getSimSwitch('hockey');
        const savedSeason = _test.seasonCaches.get('hockey');
        _test.setSimSwitch('hockey', { from: S0 });
        // The aired graph anchors its chain at the season's start; pin it to ours, with no final.
        _test.seasonCaches.set('hockey', { at: Date.now(), phase: 'regular', finalistA: null, finalistB: null, wsSlot: null, startSlot: S0, seasonNo: null });
        try {
          let dead = null;
          for (let slot = S0; slot < S0 + 400 && !dead; slot++) {
            const gs = _test.sportsGameForSlot(script, slot, null, _test.ledgerAt(script, slot, S0));
            const d = gs?.game.casualties.find(c => c.dead);
            if (d) dead = { name: d.name, slot, heal: healSlot(d, slot) };
          }
          check('hockey: a v2 season has a death to follow', !!dead, 'no death in 400 slots');
          if (dead) {
            check('hockey: a reprinted man is out until the vat is done',
              _test.ledgerAt(script, dead.heal - 1, S0).has(dead.name) && !_test.ledgerAt(script, dead.heal, S0).has(dead.name), JSON.stringify(dead));
            check('hockey: …and back from the vat once he is fit', _test.vatReturnsAt(script, dead.heal, S0).has(dead.name), JSON.stringify(dead));
            let played = null;
            for (let slot = dead.heal; slot < dead.heal + 64 && played === null; slot++) {
              const gs = _test.sportsGameForSlot(script, slot, null, _test.ledgerAt(script, slot, S0));
              if (gs && [...gs.game.away.skaters, ...gs.game.home.skaters].some(s => s.name === dead.name)) played = slot;
            }
            check('hockey: a reprinted man plays again', played !== null, `${dead.name} never dressed after ${dead.heal}`);
            if (played !== null) {
              check('hockey: …and the vat lets go of him after his first game back',
                _test.vatReturnsAt(script, played, S0).has(dead.name) && !_test.vatReturnsAt(script, played + 1, S0).has(dead.name), `first game ${played}`);
              // A line from one of the pools aired: every fixed piece of it is in a node's text.
              const said = (slot, keys) => {
                const fixed = keys.flatMap(k => pools[k] || []).map(l => l.split(/\{[^}]+\}/).map(p => p.trim()).filter(Boolean));
                const g = _test.assembleSportsGraph(script, 'bc_regress_vat', slot, null);
                const texts = Object.values(g?.nodes || {}).map(n => n.data?.text || '').filter(Boolean);
                return texts.some(t => fixed.some(parts => parts.every(p => t.includes(p))));
              };
              check('hockey: the booth says how long the vat will be', said(dead.slot, ['death.vat']), `slot ${dead.slot}`);
              check("hockey: the booth says he's back from the vat", said(played, ['vat.back', 'vat.back.again', 'vat.back.career']), `slot ${played}`);
            }
          }

          // A street death: the league loses him from the slot after the one he died in, the
          // vat has him from that slot until he heals, and nothing before it changes.
          {
            const savedDeaths = _test.streetDeaths.get('hockey');
            const S = S0 + 600, man = rosterFor(teams[2], teams, players)[1];
            const before = _test.sportsGameForSlot(script, S, null, _test.ledgerAt(script, S, S0))?.game;
            const heal = S + 1 + 30;
            _test.streetDeaths.set('hockey', [{ name: man, from: S + 1, heal }]);
            _test.injuryChains.delete('hockey');
            try {
              const after = _test.sportsGameForSlot(script, S, null, _test.ledgerAt(script, S, S0))?.game;
              check('street death: the slot he died in plays as it did', JSON.stringify(before?.beats) === JSON.stringify(after?.beats), 'the airing game changed');
              check('street death: the league loses him from the next slot', !_test.ledgerAt(script, S, S0).has(man) && _test.ledgerAt(script, S + 1, S0).has(man) && _test.ledgerAt(script, heal - 1, S0).has(man), man);
              check('street death: he plays again when the vat lets him go', !_test.ledgerAt(script, heal, S0).has(man) && _test.vatReturnsAt(script, heal, S0).has(man), `heal ${heal}`);
              check('street death: the vat has him from the slot he died in', _test.streetVatAt('hockey', S).has(man) && _test.streetVatAt('hockey', heal - 1).has(man) && !_test.streetVatAt('hockey', heal).has(man) && !_test.streetVatAt('hockey', S - 1).has(man), 'vat window');
            } finally {
              if (savedDeaths) _test.streetDeaths.set('hockey', savedDeaths); else _test.streetDeaths.delete('hockey');
              _test.injuryChains.delete('hockey');
            }
            const acc = {};
            HOCKEY.season.foldStreetDeath(acc, { name: man });
            const sx = HOCKEY.season.summariseExtras(acc);
            check('street death: it counts in his toll', sx.toll?.[man]?.died === 1 && sx.deaths === 1, JSON.stringify(sx.toll));
          }
        } finally {
          _test.setSimSwitch('hockey', savedSwitch);
          if (savedSeason) _test.seasonCaches.set('hockey', savedSeason); else _test.seasonCaches.delete('hockey');
          _test.injuryChains.delete('hockey');
        }
      }

      // ── League players who are NPCs (sports/league-npcs.js) ──
      {
        const { bindingOf, whereabouts, seasonLine, LEAGUE_ROLES } = await import('./sports/league-npcs.js');
        const club = teams[0], man = rosterFor(club, teams, players)[0];
        const b = { player: man, club, role: 'captain' };
        const st = (o = {}) => ({ playing: new Set(), next: new Set(), call: false, out: new Set(), inVat: new Set(), back: new Set(), ...o });
        check('league npc: on shift while his club plays', whereabouts(b, st({ playing: new Set([club]) })) === 'game', 'not at the game');
        check('league npc: called before the next game, not earlier', whereabouts(b, st({ next: new Set([club]), call: true })) === 'game' && whereabouts(b, st({ next: new Set([club]) })) === 'off', 'call');
        check("league npc: a hurt man doesn't go to the game", whereabouts(b, st({ playing: new Set([club]), out: new Set([man]) })) === 'off', 'hurt man at the game');
        check('league npc: the vat outranks everything', whereabouts(b, st({ playing: new Set([club]), out: new Set([man]), inVat: new Set([man]) })) === 'vat', 'vat');
        check('league npc: nobody else is bound', bindingOf({ flags: {} }) === null && bindingOf({ flags: { cphl: { club } } }) === null, 'bound without a player');
        const line = seasonLine(b, { players: { [man]: { gp: 9, g: 4, a: 1, sog: 30 } }, toll: { [man]: { hurt: 1, died: 2 } }, career: { [man]: { hurt: 0, died: 1 } } }, st());
        check('league npc: the season line says his numbers and his toll', line === 'Nine games, four goals and one assist. Carried off once and died twice. That\'s three times in the vat, all told.', line);
        const gl = seasonLine({ ...b, role: 'goalie' }, { goalies: { [man]: { gp: 1, sa: 30, ga: 4, w: 0 } } }, st());
        check("league npc: a goalie's line is saves and wins", gl === 'One game, no wins. I\'ve stopped 26 of 30.', gl);
        check("league npc: a man with no season yet says so", /haven't played/.test(seasonLine(b, null, st())), 'empty season');

        // Into the vat and out of it, through the engine's dead state.
        const fake = { id: 'npc_regress_cphl', name: 'Regress Skater', zone_id: 'zone_slush_rinkside', home_zone: 'zone_slush_rinkside', hp: 40, hp_max: 40, flags: { cphl: b } };
        world.npcs.set(fake.id, fake); world.zones.get(fake.zone_id)?.npcs.add(fake.id);
        const saved = _test.getLeagueNpcState();
        try {
          _test.applyLeagueNpcState(st({ inVat: new Set([man]) }), null);
          check('league npc: the vat takes him out of the world', fake._dead === true && fake._inVat === true && !world.zones.get(fake.zone_id)?.npcs.has(fake.id), JSON.stringify({ d: fake._dead, v: fake._inVat }));
          check('league npc: his season line is set', typeof fake.cphl?.season === 'string' && fake.cphl.season.length > 0, String(fake.cphl?.season));
          _test.applyLeagueNpcState(st(), null);
          check('league npc: the vat lets him go to the engine\'s respawn', fake._inVat === false && Number.isFinite(fake._respawnAt), String(fake._respawnAt));
          // Through the engine's bridge, as the AI asks it.
          const { isNpcScheduledNow } = await import('../../server/engine/broadcast-bridge.js');
          _test.setLeagueNpcState(st({ playing: new Set([club]) }));
          const onShift = isNpcScheduledNow(fake.id);
          _test.setLeagueNpcState(st());
          check("league npc: the schedule checker follows his club's games", onShift === true && isNpcScheduledNow(fake.id) === false && _test.leagueNpcWhere('npc_nobody') === null, String(onShift));

          // Killed in the street: the engine's 60-second respawn is taken away at once, he's in
          // the vat, and the record books him off the roster from the next slot.
          const savedDeaths = _test.streetDeaths.get('hockey');
          const { getFlag, setFlag } = await import('../../server/engine/flags.js');
          const savedRaw = await getFlag('world', _test.STREET_DEATHS_KEY('hockey')).catch(() => null);
          try {
            Object.assign(fake, { _dead: true, _respawnAt: Date.now() + 60000, _inVat: false });
            _test.setLeagueNpcState(st());
            const d = _test.onLeagueNpcKilled({ npc: fake });
            check('street death: the respawn is taken away and the vat has him', fake._respawnAt === null && fake._inVat === true, String(fake._respawnAt));
            check('street death: he is off the roster from the next slot, for the vat\'s time', !!d && d.name === man && d.heal - d.from > INJURY_MAX_SLOTS && d.heal - d.from <= REPRINT_MAX_SLOTS, JSON.stringify(d));
            check('street death: the tick keeps him in the vat', _test.leagueNpcWhere(fake.id) === 'vat', String(_test.leagueNpcWhere(fake.id)));
            check('street death: nobody else is recorded', _test.onLeagueNpcKilled({ npc: { id: 'x', _dead: true, flags: {} } }) === null, 'unbound man recorded');
            await _test.streetSaved();
            const raw = await getFlag('world', _test.STREET_DEATHS_KEY('hockey')).catch(() => null);
            check('street death: the record is written to world_flags', typeof raw === 'string' && JSON.parse(raw).some(e => e.name === man && e.from === d.from), String(raw));
          } finally {
            if (savedDeaths) _test.streetDeaths.set('hockey', savedDeaths); else _test.streetDeaths.delete('hockey');
            _test.injuryChains.delete('hockey');
            await setFlag('world', _test.STREET_DEATHS_KEY('hockey'), savedRaw ?? '[]').catch(() => {});
          }
        } finally {
          _test.setLeagueNpcState(saved);
          world.npcs.delete(fake.id); world.zones.get(fake.zone_id)?.npcs.delete(fake.id);
        }

        // The authored men: each is on the roster of the club his file names, in his role, and
        // housed in a flat with a residence row. Read from the files, so it holds before an import.
        const npcDir = new URL('../../content/npcs/', import.meta.url);
        const resDir = new URL('../../content/npc_residences/', import.meta.url);
        const zoneDir = new URL('../../content/zones/', import.meta.url);
        const bound = readdirSync(npcDir).filter(f => f.startsWith('npc_cphl_')).map(f => JSON.parse(readFileSync(new URL(f, npcDir), 'utf8'))).filter(n => bindingOf(n));
        const residents = new Map(readdirSync(resDir).map(f => JSON.parse(readFileSync(new URL(f, resDir), 'utf8'))).map(r => [r.zone_id, r.npc_id]));
        // Against the content row's league, which is what the server deals from: the .bsm
        // parse above strips the quotes off nicknames, and a different name deals different sixes.
        const row = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools;
        const wrong = [];
        for (const n of bound) {
          const nb = bindingOf(n), six = rosterFor(nb.club, row.teams, row.players);
          if (!row.teams.includes(nb.club)) wrong.push(`${n.id}: no club ${nb.club}`);
          else if (!six.includes(nb.player)) wrong.push(`${n.id}: ${nb.player} isn't a ${nb.club}`);
          else if ((nb.role === 'goalie') !== (six.indexOf(nb.player) === 5)) wrong.push(`${n.id}: ${nb.player} isn't the ${nb.club}' ${nb.role}`);
          if (!LEAGUE_ROLES.includes(nb.role)) wrong.push(`${n.id}: role ${nb.role}`);
          if (n.studio_zone_id !== 'zone_slush_rinkside') wrong.push(`${n.id}: studio_zone_id ${n.studio_zone_id}`);
          let home = null; try { home = JSON.parse(readFileSync(new URL(`${n.home_zone}.json`, zoneDir), 'utf8')); } catch {}
          if (!home?.flags?.is_apartment) wrong.push(`${n.id}: home ${n.home_zone} isn't a flat`);
          else if (!residents.has(n.home_zone)) wrong.push(`${n.id}: ${n.home_zone} has no residence row`);
          if (!JSON.stringify(n.dialogue_tree || {}).includes('${npc.cphl.season}')) wrong.push(`${n.id}: no season line in his dialogue`);
        }
        check('league npc: every bound man is his club\'s, in his role, and housed', wrong.length === 0, wrong.slice(0, 4).join('; '));
        const seats = new Set(bound.map(n => `${n.flags.cphl.club}|${n.flags.cphl.role}`));
        check('league npc: one man per club per role', seats.size === bound.length, `${bound.length} men in ${seats.size} seats`);
      }

      // Baseball must be untouched by all of this — its sim ignores the fourth argument.
      const bb = _test.sportsGameForSlot({ teams: ['A', 'B', 'C', 'D'], players: [], pools: {} }, 102, null);
      check('baseball is unaffected by the injury chain', !!bb && bb.game.awayScore >= 0, 'baseball still sims');
    }

    // ── the league table ──────────────────────────────────────────────────────
    // Hockey pays a point for losing past sixty. That rule is the whole reason its
    // table is a different shape from Deadball's.
    {
      const table = new Map();
      HOCKEY.season.fold(table, { away: { name: 'A' }, home: { name: 'B' }, awayScore: 3, homeScore: 2, overtime: false });
      HOCKEY.season.fold(table, { away: { name: 'A' }, home: { name: 'B' }, awayScore: 2, homeScore: 3, overtime: true });
      const A = table.get('A'), B = table.get('B');
      check('hockey: a win is two points', A.wins === 1 && B.wins === 1, JSON.stringify([A, B]));
      check('hockey: an overtime loss still pays a point', A.otl === 1 && A.points === 3, JSON.stringify(A));
      check('hockey: a regulation loss pays nothing', B.losses === 1 && B.points === 2, JSON.stringify(B));
    }
  }

  // ── DEADBALL hitting race ───────────────────────────────────────────────────
  // The batting leaders are folded out of the at-bat beats the sim already emits,
  // so the numbers can never disagree with the games that aired. The assertions
  // are mostly about SCORING RULES, because an average computed the naive way is
  // wrong in a way people notice: a walk and a sacrifice fly are plate appearances
  // but NOT at-bats, and counting them drags every average in the league down.
  // Deadball's season squads (sim v3): thirteen a club, nobody on two clubs, a realistic
  // turnover between seasons, and the same squads every time they're asked for.
  {
    const B = await import('./sports/baseball.js');
    const { sportsRng } = await import('./rng.js');
    const teams = Array.from({ length: 8 }, (_, i) => `Club ${i}`);
    const pool = Array.from({ length: 112 }, (_, i) => `Man ${i}`);
    const s = B.seasonOfDay(Math.floor(Date.UTC(2035, 4, 10) / 86400000));
    const squad = (R, t) => [...R.clubs[t].lineup, ...R.clubs[t].rotation, ...R.clubs[t].bench].map(e => e.name);
    const R = B.clubRosters(teams, pool, s);
    const all = teams.flatMap(t => squad(R, t));
    check('deadball squads: thirteen a club, nobody on two clubs', all.length === 104 && new Set(all).size === 104 && R.unsigned.length === 8);
    let moved = 0;
    for (let k = 1; k <= 12; k++) {
      const a = B.clubRosters(teams, pool, s + k - 1), b = B.clubRosters(teams, pool, s + k);
      for (const t of teams) { const was = new Set(squad(a, t)); moved += squad(b, t).filter(n => !was.has(n)).length; }
    }
    const per = moved / 12 / 8;
    check('deadball squads: about two men a club change each season', per >= 1 && per <= 3, `${per.toFixed(2)} a club`);
    check('deadball squads: a season deals the same squads every time', JSON.stringify(B.clubRosters(teams, pool, s)) === JSON.stringify(R));
    check('deadball squads: a pool too small for squads deals none', B.clubRosters(teams, pool.slice(0, 50), s) === null);
    const day = Math.floor(Date.UTC(2035, 4, 10) / 86400000);
    const g = B.BASEBALL.simGame({ away: 'Club 0', home: 'Club 1', teams }, pool, sportsRng(9), { version: 3, seed: 9, day });
    const want = B.lineupForDay(R.clubs['Club 0'], day);
    check('deadball v3: a club plays its own nine and the starter whose turn it is',
      JSON.stringify(g.away.lineup) === JSON.stringify(want.lineup) && g.away.pitcher === want.pitcher);
    check('deadball v3: the rotation turns over each day',
      new Set([0, 1, 2].map(k => B.lineupForDay(R.clubs['Club 0'], day + k).pitcher)).size === 3);
  }
  {
    const { SEASON: BB } = await import('./sports/baseball.js');
    const ab = (batter, kind, rbi = 0) => ({ type: 'atbat', batter, battingName: 'Rats', kind, rbi });

    const acc = {};
    BB.foldExtras(acc, { beats: [
      ab('Cole', 'single'), ab('Cole', 'walk'), ab('Cole', 'sacfly', 1),
      ab('Cole', 'strikeout'), ab('Cole', 'homerun', 2), ab('Cole', 'doubleplay'),
    ] });
    const cole = acc.bats.get('Cole');
    check('deadball: every plate appearance counts as a PA', cole.pa === 6, String(cole.pa));
    check("deadball: a walk isn't an at-bat", cole.ab === 4, `ab=${cole.ab} (walk+sacfly must be excluded from 6)`);
    check('deadball: hits count only real hits', cole.hits === 2, String(cole.hits));
    check('deadball: home runs counted', cole.hr === 1, String(cole.hr));
    check('deadball: RBI accumulate across outs too', cole.rbi === 3, String(cole.rbi));
    // The bug this guards: 2-for-6 (.333) instead of 2-for-4 (.500).
    const sum = BB.summariseExtras(acc);
    check('deadball: average is hits/AB, not hits/PA',
      Math.abs(sum.batters[0].avg - 0.5) < 1e-9, String(sum.batters[0].avg));

    // A double play and a productive out are outs the BATTER is charged with —
    // they are at-bats, unlike the sacrifice. Getting this backwards inflates
    // averages instead of deflating them.
    const acc2 = {};
    BB.foldExtras(acc2, { beats: [ab('Dunn', 'productout'), ab('Dunn', 'single')] });
    check('deadball: a productive out is still an at-bat', acc2.bats.get('Dunn').ab === 2, String(acc2.bats.get('Dunn').ab));

    // ── The Gameday half-inning changeover ────────────────────────────────────
    // The sub-screen only ever heard about at-bats, so through an inning break it
    // held the last play's final frame — a batter still flagged out on first — while
    // Chip talked over a photograph. The fix is a payload on the half's framing line,
    // and this is its only observable: what rides the assembled graph.
    {
      const script = { teams: ['Rats', 'Kings', 'Crows', 'Vultures', 'Hawks', 'Bats', 'Moles', 'Gulls', 'Elks', 'Pikes', 'Wrens', 'Boars', 'Cranes', 'Newts', 'Owls', 'Stoats'], players: [], pools: { 'half.top': ['Top {inningOrd}.'], 'half.bottom': ['Bottom {inningOrd}.'], 'atbat.out': ['He is out.'], 'atbat.single': ['Base hit.'], chatter: ['Quiet out here.'] }, announcer: 'Chip Vega' };
      const graph = _test.assembleSportsGraph(script, 'bc_regress', 12345, null);
      const gds = Object.values(graph.nodes || {}).map(n => n.data && n.data.gameday).filter(Boolean);
      const halves = gds.filter(g => g.phase === 'half');
      const atbats = gds.filter(g => !g.phase);
      check('gameday: the half-inning break carries a payload at all', halves.length >= 12, `${halves.length} half payloads`);
      check('gameday: …one the client can tell apart from a play', halves.every(g => g.phase === 'half'), 'phase marker missing');
      // Faking an at-bat's fields here would make a client animate a play that never
      // happened. Their ABSENCE is the contract.
      check('gameday: …carrying no play to animate', halves.every(g => !g.pitches && !g.basesBefore && !g.kind), 'a half payload looks like an at-bat');
      // The linescore blanking out for the whole break was the original bug's twin —
      // the one moment a viewer is actually reading it.
      check('gameday: …but keeping the linescore alive', halves.every(g => g.line && Array.isArray(g.line.away) && g.line.away.length), 'half payload has no line snapshot');
      // The booth's call at the crack (BASEBALL.contactCall): every ball in play carries one, in
      // the announcer's name, and nothing else does.
      {
        const called = { ...script, pools: { ...script.pools, 'contact.ground': ['On the ground {toward}.'], 'contact.liner': ['Lined {toward}!'], 'contact.fly': ['Fly ball {toward}.'], 'contact.pop': ['Popped up {toward}.'] } };
        const g3 = _test.assembleSportsGraph(called, 'bc_regress_contact', 12345, null);
        const all3 = Object.values(g3.nodes || {}).map(n => n.data && n.data.gameday).filter(Boolean);
        const inPlay = all3.filter(g => !g.phase && g.play);
        check('gameday: every ball in play carries the call at the crack', inPlay.length > 10 && inPlay.every(g => g.contact && /\w/.test(g.contact.text) && !/[{}]/.test(g.contact.text) && g.contact.by === 'Chip Vega'), `${inPlay.filter(g => g.contact).length}/${inPlay.length}`);
        check('gameday: …and nothing else does', all3.every(g => !g.contact || (g.play && !g.phase)));
      }
      check('gameday: …and naming who is batting', halves.every(g => g.battingTeam && g.inningOrd && (g.half === 'top' || g.half === 'bottom')), 'half payload is missing its framing');
      check('gameday: at-bat payloads are untouched by all this', atbats.length > 0 && atbats.every(g => Array.isArray(g.pitches)), `${atbats.length} at-bat payloads`);

      // What the 3-D view needs that the 2-D one never did (docs/proposals/
      // deadball-glass2.md, Phase 0). Every payload names its sport and says how long
      // its line holds; an at-bat carries the batter's side and the pitcher's arm,
      // taken from their names so a player is the same in every game.
      const { handOf, battingSide } = await import('./sports/baseball.js');
      check('gameday: every payload names its sport', gds.every(g => g.sport === 'baseball'), [...new Set(gds.map(g => g.sport))].join(','));
      check('gameday: every payload says how long its line holds', gds.every(g => Number.isFinite(g.hold) && g.hold >= 5000), gds.map(g => g.hold).slice(0, 6).join(','));
      check('gameday: an at-bat carries the batter\'s side and the pitcher\'s arm',
        atbats.every(g => /^[LR]$/.test(g.bats) && /^[LR]$/.test(g.throws)), JSON.stringify(atbats.find(g => !/^[LR]$/.test(g.bats) || !/^[LR]$/.test(g.throws)) || {}).slice(0, 120));
      check('gameday: …the same for a name every time', atbats.every(g => g.throws === handOf(g.pitcher).throws && g.bats === battingSide(g.batter, g.pitcher)), 'handedness drifted');
      {
        const counts = { R: 0, L: 0, S: 0 };
        for (let i = 0; i < 2000; i++) counts[handOf(`Player ${i}`).bats]++;
        check('gameday: about six in ten bat right, three left, one both ways',
          counts.R > 1080 && counts.R < 1320 && counts.L > 480 && counts.L < 720 && counts.S > 120 && counts.S < 280, JSON.stringify(counts));
      }
      // The league table rode every payload, about 43 KB a game per viewer. It rides the
      // game's first payload now, with the season, and the catch-up carries it to a late
      // tuner.
      const order = [];
      for (let id = graph._start; id; id = (graph.edges.find(e => e.fromNode === id && e.fromPort === 'next') || {}).toNode) order.push(graph.nodes[id]);
      const inOrder = order.map(n => n.data && n.data.gameday).filter(Boolean);
      check('gameday: the table rides the game\'s first payload', Array.isArray(inOrder[0]?.standings), 'first payload has no standings');
      check('gameday: …and no other', inOrder.slice(1).every(g => !('standings' in g)), `${inOrder.slice(1).filter(g => 'standings' in g).length} payloads still carry the table`);
      check('gameday: the first payload carries the season', inOrder[0]?.season?.phase === 'regular', JSON.stringify(inOrder[0]?.season));
      check('gameday: the leaders ride the first payload and no other',
        ['hr', 'avg', 'sb', 'k'].every((k) => Array.isArray(inOrder[0]?.leaders?.[k])) && inOrder.slice(1).every(g => !('leaders' in g)),
        JSON.stringify(inOrder[0]?.leaders).slice(0, 120));
      // A script with a venue stamps the game's first payload with it, so a client asks for
      // the park's city once (tv_venue); a script without one stamps nothing.
      {
        const withVenue = { ...script, venue: { site: { x: 897.55, y: 913.55, bearing: 315, block: { x0: 895, x1: 897, y0: 911, y1: 913 } } } };
        const g2 = _test.assembleSportsGraph(withVenue, 'bc_regress_venue', 12345, null);
        const ord2 = [];
        for (let id = g2._start; id; id = (g2.edges.find(e => e.fromNode === id && e.fromPort === 'next') || {}).toNode) ord2.push(g2.nodes[id]);
        const gd2 = ord2.map(n => n.data && n.data.gameday).filter(Boolean);
        check('gameday: a venue\'s stamp rides the first payload and no other',
          typeof gd2[0]?.venueRev === 'string' && gd2[0].venueRev.length > 4 && gd2.slice(1).every(g => !('venueRev' in g)) && !('venueRev' in (inOrder[0] || {})),
          JSON.stringify({ first: gd2[0]?.venueRev, later: gd2.slice(1).filter(g => 'venueRev' in g).length, without: inOrder[0]?.venueRev }));
      }

      // Every man's fate on every play. The 2-D view moved each runner a fixed number
      // of bags per kind of play, so a man the sim scored from second on a single
      // stopped at third. The payload says where each one goes now, and these are the
      // rules that has to keep in any game: the runners end on the bags the sim left
      // occupied, as many cross the plate as it scored, every runner and the batter has
      // exactly one fate, and nobody passes anybody or runs backwards.
      check('gameday: every at-bat says where each runner and the batter go',
        atbats.every(g => Array.isArray(g.moves) && g.moves.length === g.basesBefore.filter(Boolean).length + 1), 'an at-bat without its moves');
      {
        const { runnerMoves } = await import('./sports/baseball-gameday.js');
        const { simGame: sim } = await import('./sports/baseball.js');
        const { sportsRng: rngOf } = await import('./rng.js');
        let plays = 0;
        const wrong = [];
        const side = (x) => (x.half === 'top' ? x.awayScore : x.homeScore);
        for (let s = 1; s <= 600 && wrong.length < 3; s++) {
          let before = [false, false, false], score = 0;
          for (const b of sim({ away: 'Rats', home: 'Kings' }, null, rngOf(s * 2654435761 + 7)).beats) {
            if (b.type === 'half_start') { before = [false, false, false]; score = side(b); continue; }
            if (b.type !== 'atbat') continue;
            plays++;
            const runs = side(b) - score;
            score = side(b);
            const m = runnerMoves(before, b.bases, b.kind, runs);
            const dest = m.filter(x => x.to != null).map(x => x.to);
            const ok = dest.filter(t => t < 4).join('') === [3, 2, 1].filter(n => b.bases[n - 1]).join('')
              && dest.filter(t => t === 4).length === runs
              && m.length === before.filter(Boolean).length + 1
              && m.every(x => x.to == null || x.to >= x.from)
              && dest.every((t, i) => i === 0 || t < dest[i - 1] || (t === 4 && dest[i - 1] === 4));
            if (!ok) wrong.push(`${b.kind} ${before.map(Number).join('')}→${b.bases.map(Number).join('')} runs ${runs}: ${JSON.stringify(m)}`);
            before = b.bases;
          }
        }
        check('gameday: every play\'s runners end where the sim left them and score its runs', !wrong.length, `${wrong.length} of ${plays}: ${wrong.join(' | ')}`);
      }

      // The park's weather rides each payload as its line airs, read from the weather
      // cells over the site the script names (sports_pools.venue.site). It's never baked
      // into the assembled game, whose payloads last the hour while the cells drift, and a
      // script with no site, like hockey's indoor rink, sends none.
      {
        const { WEATHER_TYPES } = await import('../../server/engine/environment.js');
        const sited = _test.assembleSportsGraph({ ...script, venue: { site: { x: 897.55, y: 913.55, bearing: 315 } } }, 'bc_regress_wx', 12345, null);
        const gd0 = Object.values(sited.nodes).map(n => n.data && n.data.gameday).find(Boolean);
        const aired = _test.gamedayOnAir(gd0, sited);
        check('gameday: a park with a site sends the weather over it as each line airs',
          WEATHER_TYPES.includes(aired.wx?.word) && typeof aired.wx.precip === 'string' && aired.wx.rate >= 0 && aired.wx.rate <= 1, JSON.stringify(aired.wx));
        check('gameday: …read on air, never baked into the game', !Object.values(sited.nodes).some(n => n.data?.gameday && ('wx' in n.data.gameday || 'clock' in n.data.gameday)), 'a payload was assembled with wx or clock');
        check('gameday: a script with no site sends no weather', !('wx' in _test.gamedayOnAir(gd0, graph)), 'wx without a site');
        // and the world's clock as it airs, for the park's sky
        const { getEnvironmentState } = await import('../../server/engine/environment.js');
        const mins = getEnvironmentState()?.minutes;
        check('gameday: a park with a site sends the minute of the day it airs at', Number.isInteger(aired.clock) && aired.clock >= 0 && aired.clock < 1440 && (!Number.isFinite(mins) || aired.clock === Math.round(mins) % 1440), `${aired.clock} for ${mins}`);
        // every word the weather can send is one the 3-D park has a look for (diamond/weather.js)
        const { WX } = await import('../../client/game/js/panels/diamond/weather.js');
        check('gameday: the 3-D park knows every weather word', WEATHER_TYPES.every((w) => w in WX), WEATHER_TYPES.filter((w) => !(w in WX)).join(', '));
      }
    }

    // ── Base/out-aware outs ───────────────────────────────────────────────────
    // These rules are invisible in a box score but wrong in a way a viewer feels:
    // a double play used to erase the runner from first and freeze everyone else,
    // so a 6-4-3 with a man on third never scored the run it always scores.
    {
      const { simGame: sim } = await import('./sports/baseball.js');
      const { sportsRng: rngOf } = await import('./rng.js');
      let tp = 0, dpScored = 0, bad = [];
      for (let s = 0; s < 4000; s++) {
        for (const b of sim({ away: 'Rats', home: 'Kings' }, null, rngOf(s * 2654435761 + 7)).beats) {
          if (b.type !== 'atbat') continue;
          if (b.kind === 'doubleplay') {
            if (b.rbi > 0) { dpScored++; if (b.outs >= 3) bad.push('DP scored on the third out'); }
            if (b.bases[0]) bad.push('DP left the forced runner on first');
          }
          if (b.kind === 'tripleplay') {
            tp++;
            if (b.outs !== 3) bad.push(`TP ended the half at ${b.outs} outs`);
            if (b.rbi > 0) bad.push('TP scored a run');
            if (b.bases.some(Boolean)) bad.push('TP left a runner on');
          }
        }
      }
      check('deadball: a double play can drive in the run from third', dpScored > 0, 'never scored one in 4000 games');
      check('deadball: …but never on the third out', !bad.includes('DP scored on the third out'), 'a run counted after the inning ended');
      check('deadball: a triple play happens, and is rare', tp > 0 && tp < 40, `${tp} in 4000 games (want ~8)`);
      check('deadball: a triple play always ends the half clean', !bad.length, [...new Set(bad)].join('; '));
    }

    // Folding the same games twice must give the same race — the standings are a
    // recomputed fold, so any order- or state-dependence here shows up as leaders
    // that change every time someone types `standings`.
    const { simGame } = await import('./sports/baseball.js');
    const { sportsRng } = await import('./rng.js');
    const run = () => {
      const a = {};
      for (let s = 0; s < 40; s++) {
        a.__ = 0;
        BB.foldExtras(a, simGame({ away: 'Rats', home: 'Kings' }, null, sportsRng(s * 2654435761)));
      }
      return BB.summariseExtras(a);
    };
    const r1 = run(), r2 = run();
    check('deadball: the hitting race is deterministic',
      JSON.stringify(r1.batters) === JSON.stringify(r2.batters),
      `${r1.batters[0]?.name} vs ${r2.batters[0]?.name}`);
    check('deadball: the race has qualified leaders', r1.batters.length > 0 && r1.batters[0].ab > 0, JSON.stringify(r1.batters[0] || null));
    check('deadball: averages land in a believable band',
      r1.batters.every(b => b.avg > 0.1 && b.avg < 0.6), JSON.stringify(r1.batters.map(b => b.avg.toFixed(3))));
    // An empty season must not throw or invent anyone.
    const none = BB.summariseExtras({});
    check('deadball: an unplayed season has an empty race',
      none.batters.length === 0 && none.homers.length === 0, JSON.stringify(none));
  }

  // ── .bsm compilation ────────────────────────────────────────────────────────
  // Replaces the hand-run `_newsbsm_test.cjs` scratch harness that used to sit in
  // the repo root and printed a parse to the console for a human to eyeball. The
  // thing actually worth guarding is `unknownDirectives`: compileBsm SILENTLY DROPS
  // a directive it doesn't recognise, so a typo in a .bsm (or a directive removed
  // from the compiler) costs you a chunk of a show with no error anywhere. That
  // failure is invisible until someone tunes in, which is exactly what a regress
  // suite is for.
  //
  // The compiler is a browser-global script (`client/devpanel/js/bsm-compiler.js`
  // — "Functions land in global scope"), not a module, so it's evaluated in a
  // function scope and the declaration is handed back out.
  {
    const src = readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8');
    const compileBsm = new Function(`${src}\n;return compileBsm;`)();
    check('bsm: the compiler evaluates and exports compileBsm', typeof compileBsm === 'function', typeof compileBsm);

    const dir = new URL('../../data/scripts/', import.meta.url);
    const files = readdirSync(dir).filter(f => f.endsWith('.bsm')).sort();
    check('bsm: there are scripts to compile', files.length > 0, String(files.length));

    // EVERY shipped script, not just the one the old harness happened to name.
    const unknown = [], broke = [];
    for (const f of files) {
      try {
        const c = compileBsm(readFileSync(new URL(f, dir), 'utf8'));
        const u = c?._debug?.unknownDirectives || [];
        if (u.length) unknown.push(`${f}: ${u.join(', ')}`);
      } catch (e) { broke.push(`${f}: ${e.message}`); }
    }
    check('bsm: every shipped script compiles', broke.length === 0, broke.join(' | '));
    check('bsm: no script uses a directive the compiler drops', unknown.length === 0, unknown.join(' | '));

    // The news shape specifically — the roles a news bulletin can't assemble
    // without. These were the fields the old harness printed.
    const news = compileBsm(readFileSync(new URL('raptor_news.bsm', dir), 'utf8'));
    check('bsm: raptor_news is type news', news.meta.type === 'news', news.meta.type);
    check('bsm: news carries its anchors', news.newsScript.anchors.length === 2, JSON.stringify(news.newsScript.anchors));
    check('bsm: news carries its reporters', news.newsScript.reporters.length === 2, JSON.stringify(news.newsScript.reporters));
    check('bsm: news carries its announcer', !!news.newsScript.announcer, String(news.newsScript.announcer));
    check('bsm: the title asset is declared', news.assets.some(a => a.id === news.newsScript.title), JSON.stringify(news.assets.map(a => a.id)));
    // A news script assembles out of pools; an empty pool set is a silently dead show.
    for (const pool of ['open', 'story.lead', 'handoff.reporter', 'signoff']) {
      check(`bsm: news pool '${pool}' has lines`, (news.newsScript.pools[pool] || []).length > 0, pool);
    }
  }

  // ── Deadball sim v2 ─────────────────────────────────────────────────────────
  // Errors, hit batters and the running game, played from a slot the server records
  // (simVersionFor). Every game before that slot must replay as it aired, so v1 is pinned
  // by its hash above, and v2 with its new plays turned off has to be the v1 game play for
  // play: that's what proves its base logic is v1's. (Only the home side's names differ:
  // v2 stopped the home leadoff man sharing the away pitcher's name.)
  {
    const B = await import('./sports/baseball.js');
    const { gamedayPayloads } = await import('./sports/baseball-gameday.js');
    const { sportsRng: rngOf, sportsHash: hashOf } = await import('./rng.js');
    const M = { away: 'Rats', home: 'Kings' };
    const v1Play = (b) => (b.type === 'atbat'
      ? [b.inning, b.half, b.half === 'top' ? b.batter : '', b.half === 'bottom' ? b.pitcher : '', b.kind, b.outs, b.runs ?? b.rbi, b.awayScore, b.homeScore, b.walkoff, b.bases.join()]
      : [b.type, b.inning, b.half, b.awayScore, b.homeScore]);
    let same = 0;
    for (let s = 1; s <= 300; s++) {
      const seed = hashOf(s, 0);
      const a = B.simGame(M, null, rngOf(seed)), v = B.simGameV2(M, null, rngOf(seed), { seed, rates: B.SIM_V2_OFF });
      if (a.innings === v.innings && JSON.stringify(a.beats.map(v1Play)) === JSON.stringify(v.beats.map(v1Play))) same++;
    }
    check('deadball v2: with its new plays off it is the v1 game, play for play', same === 300, `${same}/300`);

    // Every play's moves turn the named runners before it into the ones after it, each man
    // has one fate, the runs and outs add up, nobody passes anybody, and a half that ends
    // on the bases has the man who was batting lead off the next one.
    const wrong = [], tally = {};
    let games = 0, runs1 = 0, runs2 = 0, selfFaced = 0;
    for (let s = 1; s <= 400 && wrong.length < 3; s++) {
      const seed = hashOf(s, 0);
      const g = B.simGameV2(M, null, rngOf(seed), { seed });
      const g1 = B.simGame(M, null, rngOf(seed));
      games++; runs1 += g1.awayScore + g1.homeScore; runs2 += g.awayScore + g.homeScore;
      let runners = [null, null, null], outs = 0, score = 0, first = true;
      const leadoff = new Map();
      for (const b of g.beats) {
        if (b.type === 'half_start') { runners = [null, null, null]; outs = 0; score = b.half === 'top' ? b.awayScore : b.homeScore; first = true; continue; }
        if (b.type === 'half_end') continue;
        const why = [];
        if (first && leadoff.has(b.battingName) && b.batter !== leadoff.get(b.battingName)) why.push('the wrong man led off');
        if (first) leadoff.delete(b.battingName);
        first = false;
        if (b.type === 'atbat' && b.batter === b.pitcher) selfFaced++;
        const m = b.moves || [];
        for (let n = 1; n <= 3; n++) if (runners[n - 1] != null && m.filter((x) => x.from === n).length !== 1) why.push(`the runner on ${n}`);
        if (m.some((x) => x.from > 0 && runners[x.from - 1] !== x.name)) why.push('a runner\'s name');
        if ((b.type === 'atbat') !== m.some((x) => x.from === 0 && x.name === b.batter)) why.push('the batter');
        const next = [null, null, null];
        for (const x of m) if (x.to >= 1 && x.to <= 3) next[x.to - 1] = x.name;
        if (JSON.stringify(next) !== JSON.stringify(b.runners)) why.push('the runners after');
        const now = b.half === 'top' ? b.awayScore : b.homeScore;
        if (now - score !== m.filter((x) => x.to === 4).length || b.runs !== now - score) why.push('the runs');
        if (b.outs - outs !== m.filter((x) => x.out != null).length) why.push('the outs');
        const dest = m.filter((x) => x.to != null).map((x) => x.to);
        if (!dest.every((t, i) => i === 0 || t < dest[i - 1] || (t === 4 && dest[i - 1] === 4))) why.push('a pass');
        if (why.length) wrong.push(`slot ${s} ${b.inning}${b.half[0]} ${b.type}:${b.kind}: ${why.join(', ')}`);
        if (b.type === 'run' && b.outs >= 3 && !b.walkoff) leadoff.set(b.battingName, b.batter);
        const k = b.type === 'run' ? b.kind : (b.kind === 'error' || b.kind === 'hitbypitch' ? b.kind : null);
        if (k) tally[k] = (tally[k] || 0) + 1;
        runners = b.runners; outs = b.outs; score = now;
      }
    }
    check('deadball v2: every play\'s moves account for every man, the runs and the outs', !wrong.length, wrong.join(' | '));
    check('deadball v2: no batter ever faces himself', selfFaced === 0, String(selfFaced));
    const per = (k) => (tally[k] || 0) / games / 2;
    const safe = per('steal') + per('doublesteal'), tries = safe + per('caughtstealing');
    check('deadball v2: a 1990s running game (0.6 to 1.2 steal tries a team a game, 60-80% safe)',
      tries > 0.6 && tries < 1.2 && safe / tries > 0.6 && safe / tries < 0.8, `${tries.toFixed(2)} tries, ${(safe / tries * 100).toFixed(0)}% safe`);
    check('deadball v2: errors, hit batters, wild pitches and passed balls at a 1990s rate',
      per('error') > 0.25 && per('error') < 0.55 && per('hitbypitch') > 0.25 && per('hitbypitch') < 0.5
        && per('wildpitch') + per('passedball') > 0.15 && per('wildpitch') + per('passedball') < 0.4,
      JSON.stringify(Object.fromEntries(Object.keys(tally).sort().map((k) => [k, +per(k).toFixed(2)]))));
    check('deadball v2: scoring stays where v1 had it (within 6%)', Math.abs(runs2 / runs1 - 1) < 0.06,
      `${(runs1 / games / 2).toFixed(2)} → ${(runs2 / games / 2).toFixed(2)} runs a team a game`);

    // The hitting race under v2's scoring: a hit batter is no at-bat, an error is an at-bat
    // with no hit and no RBI, and a play on the bases is nobody's plate appearance.
    const acc = {};
    B.SEASON.foldExtras(acc, { beats: [
      { type: 'atbat', batter: 'Cole', battingName: 'Rats', kind: 'hitbypitch', rbi: 0, runs: 0 },
      { type: 'atbat', batter: 'Cole', battingName: 'Rats', kind: 'error', rbi: 0, runs: 1 },
      { type: 'run', batter: 'Cole', battingName: 'Rats', kind: 'steal', runner: 'Cole', rbi: 0, runs: 0 },
    ] });
    const cole = acc.bats.get('Cole');
    check('deadball v2: a hit batter is a plate appearance but no at-bat', cole.pa === 2 && cole.ab === 1, JSON.stringify(cole));
    check('deadball v2: an error is an at-bat with no hit and no RBI', cole.hits === 0 && cole.rbi === 0, JSON.stringify(cole));

    // The ledger's scoring rules on innings built by hand. Earned runs: the errors counted
    // as outs would have ended this half before the home run, so its runs are unearned,
    // and so is the man who reached on the error. A double steal with a man thrown out
    // credits nobody with a steal.
    {
      const P = 'Arm', T = 'Kings', BT = 'Rats';
      const play = (o) => ({ type: 'atbat', inning: 1, half: 'top', battingName: BT, fieldingName: T, pitcher: P, out: false, rbi: 0, runs: 0, ...o });
      const L = B.foldGame({}, { away: { name: BT }, home: { name: T }, awayScore: 3, homeScore: 4, beats: [
        { type: 'half_start', inning: 1, half: 'top', battingName: BT, fieldingName: T, pitcher: P },
        play({ batter: 'Ash', kind: 'strikeout', outs: 1, out: true }),
        play({ batter: 'Bly', kind: 'error', outs: 1, moves: [{ from: 0, to: 1, name: 'Bly' }] }),
        play({ batter: 'Cat', kind: 'flyout', outs: 2, out: true, moves: [{ from: 1, to: 1, name: 'Bly' }, { from: 0, out: 0, name: 'Cat' }] }),
        play({ batter: 'Dax', kind: 'homerun', outs: 2, rbi: 2, runs: 2, moves: [{ from: 1, to: 4, name: 'Bly' }, { from: 0, to: 4, name: 'Dax' }] }),
        { type: 'run', inning: 1, half: 'top', battingName: BT, fieldingName: T, pitcher: P, batter: 'Eve', kind: 'doublesteal', runner: 'Fay', out: true, outs: 3, runs: 0,
          moves: [{ from: 2, out: 3, name: 'Fay' }, { from: 1, to: 2, name: 'Gus' }] },
      ] });
      const arm = L.arms.get(P);
      check('deadball ledger: runs the errors would have stopped are unearned', arm.er === 0 && arm.outs === 3 && arm.k === 1, JSON.stringify(arm));
      check('deadball ledger: the side that won gives its pitcher the win', arm.w === 1 && arm.l === 0, JSON.stringify(arm));
      check('deadball ledger: a double steal with a man thrown out credits no steal',
        L.bats.get('Fay')?.cs === 1 && !L.bats.get('Gus')?.sb, JSON.stringify([L.bats.get('Fay'), L.bats.get('Gus')]));
      const clean = B.foldGame({}, { beats: [
        { type: 'half_start', inning: 1, half: 'top', battingName: BT, fieldingName: T, pitcher: P },
        play({ batter: 'Ash', kind: 'single', outs: 0, moves: [{ from: 0, to: 1, name: 'Ash' }] }),
        play({ batter: 'Bly', kind: 'homerun', outs: 0, rbi: 2, runs: 2, moves: [{ from: 1, to: 4, name: 'Ash' }, { from: 0, to: 4, name: 'Bly' }] }),
      ] });
      check('deadball ledger: runs with no error behind them are earned', clean.arms.get(P).er === 2, JSON.stringify(clean.arms.get(P)));
    }

    // The ledger over real games: a win and a loss a game, every strikeout and every out
    // made counted once, earned runs no more than the runs, and the steals the plays made.
    {
      const L = {};
      let games = 0, ks = 0, outs = 0, runs = 0, sb = 0, cs = 0;
      for (let s = 1; s <= 120; s++) {
        const seed = hashOf(s, 3);
        const g = B.simGameV2(M, null, rngOf(seed), { seed });
        B.SEASON.foldExtras(L, g); games++;
        runs += g.awayScore + g.homeScore;
        let o = 0;
        for (const b of g.beats) {
          if (b.type === 'half_start') { o = 0; continue; }
          if (b.type !== 'atbat' && b.type !== 'run') continue;
          outs += b.outs - o; o = b.outs;
          if (b.type === 'atbat' && b.kind === 'strikeout') ks++;
          if (b.kind === 'steal') sb++;
          if (b.kind === 'caughtstealing') cs++;
          if (b.kind === 'doublesteal') { if (b.out) cs++; else sb += 2; }
        }
      }
      const arms = [...L.arms.values()], bats = [...L.bats.values()];
      const sum = (a, k) => a.reduce((t, r) => t + r[k], 0);
      check('deadball ledger: a win and a loss a game', sum(arms, 'w') === games && sum(arms, 'l') === games, `${sum(arms, 'w')}-${sum(arms, 'l')} over ${games}`);
      check('deadball ledger: every strikeout and every out counted once', sum(arms, 'k') === ks && sum(arms, 'outs') === outs, `${sum(arms, 'k')}/${ks} K, ${sum(arms, 'outs')}/${outs} outs`);
      check('deadball ledger: earned runs are most of the runs, never more', sum(arms, 'er') <= runs && sum(arms, 'er') > runs * 0.85, `${sum(arms, 'er')} of ${runs}`);
      check('deadball ledger: the steals the plays made', sum(bats, 'sb') === sb && sum(bats, 'cs') === cs, `${sum(bats, 'sb')}/${sb} SB, ${sum(bats, 'cs')}/${cs} CS`);
      const x = B.SEASON.summariseExtras(L);
      check('deadball ledger: the steals and strikeout races lead with the most',
        x.steals.length === 5 && x.steals[0].sb >= x.steals[4].sb && x.strikeouts.length === 5 && x.strikeouts[0].k >= x.strikeouts[4].k && x.strikeouts[0].era > 0,
        JSON.stringify([x.steals[0], x.strikeouts[0]]));

      // The payloads read it: with the season so far, each play carries the batter's and
      // the pitcher's lines as they stood before it, the ledger stays as it was, a steal
      // carries the runner's count with it and the clocks it was run against, and with no
      // season the payloads carry no lines at all.
      const before = JSON.stringify([...x.ledger.bats.entries()]);
      const fmt = { abbr: (n) => String(n).slice(0, 3), ordinal: (n) => `${n}th` };
      let seen = 0, stealPays = 0;
      const bad = [];
      for (let s = 200; s < 260; s++) {
        const seed = hashOf(s, 3);
        const g = B.simGameV2(M, null, rngOf(seed), { seed });
        const pays = gamedayPayloads(g, seed, { ...fmt, ledger: x.ledger }).order.filter((p) => p.phase !== 'half');
        const tonight = new Map();
        for (const p of pays) {
          const base = x.ledger.bats.get(p.batter);
          const t = tonight.get(p.batter) || 0;
          if (!p.phase && base && p.bl[0] !== base.ab + t) bad.push(`${p.batter} AB ${p.bl[0]} not ${base.ab}+${t}`);
          if (!p.phase && !['walk', 'sacfly', 'hitbypitch'].includes(p.kind)) tonight.set(p.batter, t + 1);
          if (!Array.isArray(p.bl) || !Array.isArray(p.pl) || p.bl.length !== 5 || p.pl.length !== 5) bad.push(`${p.kind} without its lines`);
          if (p.kind === 'steal' || p.kind === 'caughtstealing' || p.kind === 'doublesteal') {
            stealPays++;
            if (!(p.plate >= 1.2 && p.plate <= 1.6 && p.pop >= 1.85 && p.pop <= 2.15)) bad.push(`clocks ${p.plate}/${p.pop}`);
            if (p.kind === 'steal' && !(p.sb >= 1)) bad.push(`a steal with sb ${p.sb}`);
          }
          seen++;
        }
      }
      check('gameday: each play carries the men\'s lines as they stood before it', !bad.length && seen > 1000 && stealPays > 0, bad.slice(0, 3).join(' | ') || `${seen} plays, ${stealPays} steals`);
      check('gameday: the lines never write to the season they start from', JSON.stringify([...x.ledger.bats.entries()]) === before, 'the ledger changed');
      const bare = gamedayPayloads(B.simGameV2(M, null, rngOf(hashOf(9, 3)), { seed: hashOf(9, 3) }), hashOf(9, 3), fmt).order;
      check('gameday: with no season, no lines', bare.every((p) => !('bl' in p) && !('pl' in p)), 'a line from tonight alone');
    }
    const hbp = B.synthPitches(12345, 'hitbypitch');
    const last = hbp[hbp.length - 1], prev = hbp[hbp.length - 2] || { balls: 0, strikes: 0 };
    check('deadball v2: a hit batter\'s last pitch hits him and counts as neither', last.result === 'hbp' && last.balls === prev.balls && last.strikes === prev.strikes, JSON.stringify(last));

    // The payloads: a play on the bases rides one of its own (phase run, with its moves and
    // no pitches), an at-bat carries the sim's moves with the names, and the line counts
    // errors in a v2 game only.
    const fmt = { abbr: (n) => String(n).slice(0, 3), ordinal: (n) => `${n}th` };
    let s2 = 1, g2;
    do { const seed = hashOf(s2++, 0); g2 = { seed, game: B.simGameV2(M, null, rngOf(seed), { seed }) }; } while (!g2.game.beats.some((b) => b.type === 'run') && s2 < 50);
    const ord2 = gamedayPayloads(g2.game, g2.seed, fmt).order;
    const runPays = ord2.filter((p) => p.phase === 'run');
    check('gameday v2: a play on the bases rides its own payload, with its moves and no pitches',
      runPays.length > 0 && runPays.every((p) => p.kind && Array.isArray(p.moves) && !('pitches' in p) && !p.moves.some((m) => m.from === 0)), `${runPays.length} plays on the bases`);
    check('gameday v2: an at-bat carries the sim\'s own moves, names and all',
      ord2.filter((p) => !p.phase).every((p) => p.moves.length && p.moves.every((m) => typeof m.name === 'string')), 'a v2 move without a name');
    const ord1 = gamedayPayloads(B.simGame(M, null, rngOf(g2.seed)), g2.seed, fmt).order;
    check('gameday v2: the line counts errors in a v2 game and not in a v1 game',
      ord2.every((p) => !p.line || Number.isFinite(p.line.eAway)) && ord1.every((p) => !p.line || !('eAway' in p.line)), 'E in the wrong line');

    // The switch. Asked for, it's recorded at the first slot of the next in-game day; no
    // longer asked for, an end slot the same way; sportsGameForSlot plays the slot's version.
    const next = _test.nextSimSwitch;
    check('sim switch: asked for and not recorded, it starts at the next in-game day', JSON.stringify(next(null, true, 8003)) === JSON.stringify({ from: 8008 }), JSON.stringify(next(null, true, 8003)));
    check('sim switch: recorded and still asked for, nothing changes', next({ from: 8008 }, true, 8100) === null, JSON.stringify(next({ from: 8008 }, true, 8100)));
    check('sim switch: no longer asked for, it ends at the next in-game day', JSON.stringify(next({ from: 8008 }, false, 8100)) === JSON.stringify({ from: 8008, until: 8104 }), JSON.stringify(next({ from: 8008 }, false, 8100)));
    check('sim switch: once it has played and ended, it stays off', next({ from: 8008, until: 8104 }, true, 8200) === null, JSON.stringify(next({ from: 8008, until: 8104 }, true, 8200)));
    check('sim switch: ended before its first slot, it can start again', JSON.stringify(next({ from: 8008, until: 8008 }, true, 8020)) === JSON.stringify({ from: 8024 }), JSON.stringify(next({ from: 8008, until: 8008 }, true, 8020)));
    const bsm = new Function(`${readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8')}\n;return compileBsm;`)();
    const deadball = bsm(readFileSync(new URL('../../data/scripts/baseball.bsm', import.meta.url), 'utf8')).sportsScript;
    check('sim switch: @sim 2 in a .bsm compiles to sports_pools.sim', bsm('@type sports\n@sport baseball\n@sim 2\n').sportsScript?.sim?.version === 2, 'no sim');
    const recorded = _test.getSimSwitch('baseball');   // whatever this database has recorded
    try {
      _test.setSimSwitch('baseball', { from: 50000, until: 50011 });   // 50011, not 50010: that slot is hockey's
      const ver = (slot) => _test.sportsGameForSlot(deadball, slot, null).game.version || 1;
      check('sim switch: a slot before it plays v1 and the slot it starts at plays v2', ver(49999) === 1 && ver(50000) === 2, `${ver(49999)}, ${ver(50000)}`);
      check('sim switch: a slot after it ends plays v1 again', ver(50011) === 1, String(ver(50011)));

      // The booth: lines for every new play and for a tied score, and under v2 every play
      // on the bases that airs is called with every token filled.
      for (const pool of ['atbat.hitbypitch', 'atbat.error', 'atbat.error.throwing', 'run.steal', 'run.caughtstealing', 'run.pickoff', 'run.throwover',
        'run.doublesteal', 'run.doublesteal.out', 'run.wildpitch', 'run.wildpitch.score', 'run.passedball', 'run.passedball.score', 'score.tied']) {
        check(`deadball: the booth has lines for ${pool}`, (deadball.pools[pool] || []).length > 0, pool);
      }
      _test.setSimSwitch('baseball', { from: 0 });
      let aired = 0;
      const badLines = [];
      for (let slot = 70000; slot < 70012; slot++) {
        const g = _test.assembleSportsGraph(deadball, 'bc_regress_v2', slot, null);
        if (!g) continue;   // hockey's slot
        for (const n of Object.values(g.nodes)) {
          const d = n.data || {};
          if (d.gameday?.phase === 'run') aired++;
          if (/[{}]|\s[.,!?]|\s{2}|out in front by 0/.test(d.text || '')) badLines.push(`slot ${slot}: "${d.text}"`);
        }
      }
      check('deadball v2: plays on the bases air with their calls, every token filled, no leader in a tie', aired > 0 && !badLines.length, `${aired} aired; ${badLines.slice(0, 3).join(' | ')}`);
    } finally {
      _test.setSimSwitch('baseball', recorded);
    }
  }

  // ── Deadball's league and clubs ─────────────────────────────────────────────
  // Eight clubs, as the CPhL has, and the row airs the league the .bsm names. A club with an
  // identity (sports_pools.clubs, build-deadball-clubs.mjs) is in the league and carries a
  // full crest, a small one and both kits; a game's payloads stamp the set's revision.
  {
    const bsm = new Function(`${readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8')}\n;return compileBsm;`)();
    const teams = bsm(readFileSync(new URL('../../data/scripts/baseball.bsm', import.meta.url), 'utf8')).sportsScript.teams;
    const row = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_1783289744953.json', import.meta.url), 'utf8')).sports_pools;
    check('deadball: the league is eight clubs', teams.length === 8 && new Set(teams).size === 8, `${teams.length}: ${teams.join(', ')}`);
    check('deadball: the row carries the .bsm league', JSON.stringify(row.teams) === JSON.stringify(teams), (row.teams || []).join(', '));
    const clubs = row.clubs || {};
    const strays = Object.keys(clubs).filter((t) => !teams.includes(t));
    check('deadball: every club with an identity is in the league', !strays.length, strays.join(', '));
    check('deadball: the Blue Birds and the Crows have identities', !!(clubs['Basin Blue Birds'] && clubs['Coldwater Crows']), Object.keys(clubs).join(', '));
    for (const [name, c] of Object.entries(clubs)) {
      check(`deadball: ${name} have a crest, full and small`, !!(c?.crest?.layers?.length && c?.crest?.small?.length), JSON.stringify(Object.keys(c || {})));
      check(`deadball: ${name} have home and road kits`, ['home', 'road'].every((s) => /^#[0-9a-f]{6}$/i.test(c?.kit?.[s]?.base || '') && c.kit[s].wordmark), JSON.stringify(c?.kit || null));
    }
    // the set goes out once a revision; Deadball's sixteen-club plan budgeted simpler crests
    // than the CPhL's, so hold each club well under a hockey club's share
    const big = Object.entries(clubs).filter(([, c]) => JSON.stringify(c).length > 24 * 1024).map(([t, c]) => `${t} ${(JSON.stringify(c).length / 1024).toFixed(1)} KB`);
    check('deadball: each club identity is under 24 KB', !big.length, big.join(', '));
    const { default: BASEBALL } = await import('./sports/baseball.js');
    const { default: HOCKEY } = await import('./sports/hockey.js');
    check('deadball: baseball stamps its clubs as hockey does', typeof BASEBALL.clubsRevOf === 'function' && BASEBALL.clubsRevOf === HOCKEY.clubsRevOf && BASEBALL.clubsRevOf(clubs).length > 4, 'clubsRevOf');
    const g = _test.assembleSportsGraph({ ...row, clubs }, 'bc_regress_clubs', 81234, null);
    const gds = Object.values(g.nodes).map((n) => n.data?.gameday).filter(Boolean);
    check('deadball: every Gameday payload carries the clubs\' stamp', gds.length > 0 && gds.every((p) => p.clubsRev === BASEBALL.clubsRevOf(clubs)), `${gds.length} payloads, ${gds.filter((p) => !p.clubsRev).length} unstamped`);
  }

  // ── Deadball's balls in play ────────────────────────────────────────────────
  // The server decides every ball in play (synthPlay) so the booth's line can agree with the
  // picture. It's cosmetic and seeded on its own, so it can't move a game: the v1 hash above
  // holds with it built. Here: every play agrees with its kind and the sim, building the
  // payloads leaves the game as it was, and the bare line pools say nothing that only some
  // plays of their kind show (docs/bsm-format.md).
  {
    const B = await import('./sports/baseball.js');
    const { gamedayPayloads } = await import('./sports/baseball-gameday.js');
    const { sportsRng: rngOf, sportsHash: hashOf } = await import('./rng.js');
    const { fenceAt } = await import('../../client/game/js/panels/diamond/play.js');
    const M = { away: 'Rats', home: 'Kings' };
    const fmt = { abbr: (n) => String(n).slice(0, 3).toUpperCase(), ordinal: (n) => `${n}th` };
    const KIND_T = {
      groundout: ['gb'], productout: ['gb'], doubleplay: ['gb'], tripleplay: ['gb'], flyout: ['fb'], sacfly: ['fb'], popout: ['pu'],
      single: ['gb', 'ld', 'fb'], double: ['gb', 'ld', 'fb'], triple: ['gb', 'ld', 'fb'], homerun: ['ld', 'fb'], error: ['gb', 'ld', 'fb'],
    };
    const GRADES = new Set(['routine', 'ranging', 'diving', 'sliding', 'leaping', 'barehand', 'rail']);
    const POS = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
    const bad = [];
    let plays = 0, none = 0, untouched = 0, same = 0, games = 0;
    const why = (play, b, msg) => bad.push(`${b.kind} ${JSON.stringify(play)}: ${msg}`);
    for (let s = 1; s <= 160 && bad.length < 4; s++) {
      const seed = hashOf(s, 11);
      const game = s % 2 ? B.simGameV2(M, null, rngOf(seed), { seed }) : B.simGame(M, null, rngOf(seed));
      const before = JSON.stringify(game);
      const { atbat } = gamedayPayloads(game, seed, fmt);
      games++;
      if (JSON.stringify(game) === before) untouched++;
      const again = gamedayPayloads(game, seed, fmt).atbat;
      if ([...atbat].every(([b, p]) => JSON.stringify(p.play) === JSON.stringify(again.get(b).play))) same++;
      for (const [b, p] of atbat) {
        const play = p.play;
        if (b.type === 'run' || !KIND_T[b.kind]) { if (play) why(play, b, 'nothing was put in play'); else none++; continue; }
        plays++;
        if (!play) { why({}, b, 'no play'); continue; }
        const { t, dir, ev, la, d, f, g } = play;
        const fence = fenceAt(dir);
        if (!KIND_T[b.kind].includes(t)) why(play, b, `a ${t} isn't a ${b.kind}`);
        if (!Array.isArray(f) || !f.length || f.some((n) => !(n >= 1 && n <= 9))) why(play, b, 'the fielders');
        if (![dir, ev, la, d].every(Number.isInteger) || !(ev >= 40 && ev <= 120) || !(d > 0) || !(play.sp >= 0 && play.sp <= 1)) why(play, b, 'the numbers');
        if (Math.abs(dir) > 45 && !(b.kind === 'popout' && play.foul)) why(play, b, 'foul');
        if (g && !GRADES.has(g)) why(play, b, `grade ${g}`);
        if ((b.kind === 'groundout' || b.kind === 'productout') && !(f.length === 1 ? f[0] === 3 : f[f.length - 1] === 3 || f.join('') === '31')) why(play, b, 'not out at first');
        if (b.kind === 'doubleplay' && !(f[f.length - 1] === 3 && [4, 6].includes(f.length === 2 ? f[0] : f[1]))) why(play, b, 'not a double play turned at second');
        if (b.kind === 'tripleplay' && f.join('') !== '543') why(play, b, 'not 5-4-3');
        if ((b.kind === 'flyout' || b.kind === 'sacfly') && !(f[0] >= 7 && d <= fence + 3)) why(play, b, 'not caught in the outfield');
        if (b.kind === 'popout' && !(f[0] <= 6)) why(play, b, 'not caught on the infield');
        if (b.kind === 'homerun' && !(d > fence)) why(play, b, `lands at ${d}, inside the fence at ${Math.round(fence)}`);
        if (!['homerun', 'flyout', 'sacfly'].includes(b.kind) && d > fence) why(play, b, 'past the fence');
        if (['single', 'double', 'triple'].includes(b.kind) && g && !play.th) why(play, b, 'a hit somebody fielded');
        if (b.kind === 'error' && f[0] !== POS[b.fielder]) why(play, b, `the sim charged ${b.fielder}`);
        if (b.kind === 'error' && !(b.errorType === 'throwing' ? ['past', 'stands'] : ['boot', 'legs', 'drop']).includes(play.e)) why(play, b, `a ${b.errorType} error is ${play.e}`);
      }
    }
    check('deadball plays: every ball in play agrees with its kind and the sim, and nothing else has one',
      !bad.length && plays > 3000 && none > 1000, `${plays} plays, ${none} without; ${bad.slice(0, 3).join(' | ')}`);
    check('deadball plays: building the payloads leaves the game as it was, and the same at-bat gets the same play',
      untouched === games && same === games, `${untouched}/${games} untouched, ${same}/${games} the same`);

    // The booth. A pool named for a kind of play airs on every play of that kind, so its lines
    // can't name a direction, a depth, a kind of contact or a kind of catch: those live in a pool
    // with the play's tag after it. Each word list below is what a bare line can't say, less what
    // its kind always is (a groundout is always on the ground, a home run always over the wall).
    const bsm = new Function(`${readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8')}\n;return compileBsm;`)();
    const pools = bsm(readFileSync(new URL('../../data/scripts/baseball.bsm', import.meta.url), 'utf8')).sportsScript.pools;
    const PICTURE = {
      left: /\bleft\b(?! (?:on|standing|over|in|out)\b)/i,
      right: /\bright\b(?! (?:past|through|there|now|away|here|back|off|on|into|in)\b)/i,
      centre: /\bcent(?:re|er)\b/i, gap: /\bgaps?\b/i, wall: /\bwalls?\b/i, line: /\b(?:lines?|liners?|laces|laser)\b/i,
      deep: /\bdeep\b/i, shallow: /\bshallow\b/i, short: /\bshort\b/i, horn: /\baround the horn\b/i, corner: /\bcorner\b/i,
      track: /\btrack\b/i, hole: /\bhole\b/i, middle: /\bup the middle\b|\bcomebacker\b/i, infield: /\binfield/i, outfield: /\boutfield/i,
      routine: /\broutine\b|\beasy\b|\bcamped\b|\btailor-made\b|\bright at\b/i, dive: /\bdiv(?:e|es|ing)\b|\bdove\b|\blays? out\b/i,
      leap: /\bleap|\bjump/i, slide: /\bslid(?:e|es|ing)\b/i, barehand: /\bbare/i, standup: /\bstand(?:ing|-up)\b/i,
      bloop: /\bbloop|\bflare\b/i, chop: /\bchop|\bdribbl|\btaps?\b|\broller\b/i, foul: /\bfoul\b|\bfair\b/i, pole: /\bpole\b/i,
      seats: /\bseats\b|\bstands\b|\bfirst row\b/i, fence: /\bfence\b/i, pull: /\bpull|\bturns on\b|\bother way\b/i,
      ground: /\bground(?:er|ers|s| ball)?\b|\bbounces?\b/i, fly: /\bfl(?:y|ies|ied)\b|\blifts?\b|\bskies\b/i, pop: /\bpop/i, up: /\bstraight up\b/i,
    };
    const ON_GROUND = ['ground', 'infield'], IN_AIR = ['fly', 'outfield'], OVER = ['deep', 'wall', 'fence'];
    const BARE = {
      'atbat.groundout': ON_GROUND, 'atbat.productout': ON_GROUND, 'atbat.doubleplay': ON_GROUND, 'atbat.tripleplay': ON_GROUND,
      'atbat.flyout': IN_AIR, 'atbat.sacfly': [...IN_AIR, 'deep'], 'atbat.popout': ['pop'], 'atbat.out': [],
      'atbat.single': [], 'atbat.double': [], 'atbat.triple': ['deep'], 'atbat.error': [], 'atbat.error.throwing': [],
      rbi: [], hr: OVER, 'hr.solo': OVER, 'hr.grand': OVER,
    };
    const loose = [];
    for (const [key, always] of Object.entries(BARE)) {
      for (const line of pools[key] || []) {
        const said = Object.entries(PICTURE).filter(([w, re]) => !always.includes(w) && re.test(line)).map(([w]) => w);
        if (said.length) loose.push(`${key}: [${said.join(', ')}] "${line}"`);
      }
    }
    check('deadball booth: a bare pool names no direction, depth or kind of catch', !loose.length, loose.slice(0, 3).join(' | '));
    check('deadball booth: every bare pool has lines', Object.keys(BARE).every((k) => (pools[k] || []).length), Object.keys(BARE).filter((k) => !(pools[k] || []).length).join(', '));
    // Each suffixed pool's suffix, after the longest bare pool it qualifies, is a tag a play
    // carries: a misspelt tag would be a pool that never airs.
    const keys = Object.keys(BARE).sort((a, b) => b.length - a.length);
    const unknown = Object.keys(pools).filter((k) => {
      const base = keys.find((b) => k.startsWith(`${b}.`));
      return base && !BARE[k] && !B.PLAY_TAGS.has(k.slice(base.length + 1));
    });
    check('deadball booth: every suffixed pool is named for a tag a play carries', !unknown.length, unknown.join(', '));
  }

  // ── Acted-live shows run on the REAL clock inside an in-game slot ────────────
  // A daily slot is authored in in-game seconds since midnight; an assembled show is a
  // real-time performance. Handing the seeker raw in-game seconds ran it `timeScale` laps
  // too far and dropped nearly every viewer in the back third of the episode: two lines
  // and the credits, over and over. These lock the conversion and the wrap.
  {
    const A = _test;
    // 4 lines at a known hold, so a lap is arithmetic rather than a magic number.
    const nodes = { start: { type: 'start', data: {} } };
    const edges = [];
    let prev = 'start';
    for (let i = 1; i <= 4; i++) {
      nodes[`l${i}`] = { type: 'say', data: { text: `line ${i}`, holdMs: 5000 } };
      edges.push({ fromNode: prev, fromPort: 'next', toNode: `l${i}` });
      prev = `l${i}`;
    }
    const g = { _start: 'start', nodes, edges, _normalized: true };

    check('seek: a lap is measured with the walker\'s own holds', A.graphLapSec(g) === 20, String(A.graphLapSec(g)));
    check('seek: a graph with no timed content has no lap', A.graphLapSec({ _start: 's', nodes: { s: { type: 'start', data: {} } }, edges: [] }) === 0, 'empty');

    // The conversion itself. timeScale is whatever the live world is running at, so assert
    // the RELATIONSHIP rather than a literal: an offset of one lap's worth of in-game
    // seconds must land back at the top, not `timeScale` laps in.
    const ts = A.envTimeScale ? A.envTimeScale() : null;
    const lapGameSec = 20 * (ts || 1);
    if (ts) {
      check('seek: one lap of in-game seconds wraps to the top', Math.abs(A.actedSeekSec(g, lapGameSec)) < 0.001, String(A.actedSeekSec(g, lapGameSec)));
      check('seek: half a lap lands half way in', Math.abs(A.actedSeekSec(g, lapGameSec / 2) - 10) < 0.001, String(A.actedSeekSec(g, lapGameSec / 2)));
      // The actual bug: a two-hour block against a twenty-second show must never seek
      // past the end of a lap, whatever the clock is doing.
      const twoHours = 7200;
      check('seek: a whole block still lands inside one lap',
        A.actedSeekSec(g, twoHours) >= 0 && A.actedSeekSec(g, twoHours) < 20, String(A.actedSeekSec(g, twoHours)));
    }
    check('seek: a negative offset is treated as the top', A.actedSeekSec(g, -50) === 0, String(A.actedSeekSec(g, -50)));

    // And the seeker itself, driven with a converted offset, lands on a real node rather
    // than running off the end into the credits.
    {
      const bb = {};
      A.seekGraph(g, bb, 12 * 1000, 0);
      check('seek: a converted offset lands mid-show', bb.currentNode === 'l3', String(bb.currentNode));
    }
  }

  // ── Everybody who has to be there is actually booked to be there ─────────────
  // `conditions.npc_staff` is the ONLY thing that puts a cast member on the clock, and it
  // is derived, not authored — so nothing in the content files can be inspected to tell
  // whether a show has a cast. Two bugs lived in that blind spot for months: the derivation
  // never handled `weather_pools.host`, so DOOMCAST's weathercaster was staffed nowhere
  // while the forecast was still presence-gated on him; and nothing ran the derivation at
  // boot, so a database seeded from git had no staffing at all and EVERY acted show sat on
  // a stand-by card. Both are invisible in code review and obvious here: walk the live
  // playlist and assert that anything performed has bodies booked, and that each of them
  // has somewhere to be called to.
  {
    const { rows } = await query(`
      SELECT p.id, p.conditions, b.name AS bname, b.playback_mode, c.channel_type, c.studio_zone_id
        FROM media_channel_playlist p
        JOIN media_broadcasts b ON b.id = p.broadcast_id
        JOIN media_channels    c ON c.id = p.channel_id
       WHERE p.broadcast_id IS NOT NULL
    `);
    const acted = rows.filter(r =>
      r.channel_type === 'live' || ['weather', 'talkshow', 'morning', 'gameshow'].includes(r.playback_mode));
    check('staffing: the world has acted programming to check', acted.length > 0, `${acted.length} acted slot(s)`);

    const staffOf = (r) => {
      let c = r.conditions;
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
      return Array.isArray(c?.npc_staff) ? c.npc_staff : [];
    };
    const unstaffed = acted.filter(r => !staffOf(r).length);
    check('staffing: every acted slot has a cast booked on it',
      unstaffed.length === 0, unstaffed.map(r => r.bname).join(', ') || 'all staffed');

    // The weather forecast specifically — the mode the derivation used to skip.
    const wx = acted.filter(r => r.playback_mode === 'weather');
    check('staffing: a forecast staffs its weathercaster',
      wx.length === 0 || wx.every(r => staffOf(r).length),
      wx.map(r => `${r.bname}:${staffOf(r).length}`).join(', ') || 'no forecasts');

    // Booked is not the same as routed: an NPC with no work_zone_id never leaves home,
    // because CHECK_WORK bails before it ever asks whether they're on shift.
    const stranded = [];
    for (const r of acted) {
      if (!r.studio_zone_id) continue;
      for (const id of staffOf(r)) {
        const npc = world.npcs?.get(id);
        if (npc && !npc.work_zone_id && !npc.studio_zone_id) stranded.push(`${npc.name || id} (${r.bname})`);
      }
    }
    check('staffing: every booked cast member has a studio to walk to',
      stranded.length === 0, stranded.join(', ') || 'all routed');
  }

  // ── GO_TO_STUDIO is not a second, worse commute ──────────────────────────────
  // It used to be a hand-rolled walker doing a quarter of GO_TO_WORK's pace with no
  // late-catch-up and no blocked-path warning, offered to authors in the VINE editor
  // right next to the good one. Any graph that picked it missed its call.
  {
    const src = readFileSync(new URL('../../server/engine/ai-behaviour.js', import.meta.url), 'utf8');
    check('commute: GO_TO_STUDIO shares GO_TO_WORK\'s body',
      /case 'GO_TO_STUDIO':\s*\n\s*case 'GO_TO_WORK':/.test(src), 'fall-through present');
    check('commute: no separate studio walker survives',
      !/case 'GO_TO_STUDIO': \{/.test(src), 'duplicate removed');
  }

  // ── Call time: staff are on the clock BEFORE their slot opens ────────────────
  // GO_TO_STUDIO walks one tile per 15s AI tick from wherever the cast sleep, so a host who
  // comes on shift at the instant the slot opens is a stand-by card away from the couch.
  {
    const A = _test;
    const DAY = 86400;
    const lead = A.staffCallLeadGameSec();
    check('call time: the lead is real minutes scaled to game seconds', lead > 0, String(lead));

    const slot = { broadcastId: 'bc_am', startTime: 6 * 3600, duration: 7200, days: 127, npcStaff: ['npc_a'], playback_mode: 'morning' };
    const list = [slot];
    const S = (secs, dow = 3) => A.staffCallSlot(list, secs, dow, 'npc_a');

    check('call time: called during the run-up', !!S(6 * 3600 - Math.min(lead, 3600) / 2), 'run-up');
    check('call time: not called a whole day early', !S(6 * 3600 - lead - 600), 'too early');
    check("call time: the open slot isn't the call window", !S(6 * 3600), 'at airtime');
    check('call time: somebody else\'s slot never calls you', !A.staffCallSlot(list, 6 * 3600 - 60, 3, 'npc_b'), 'other npc');

    // A slot that doesn't air today must not commute its cast: the mask is checked against
    // the day the slot OPENS on, which is what makes the midnight wrap correct.
    const friOnly = [{ ...slot, broadcastId: 'bc_fri', days: 1 << 5 }];
    check('call time: a day-restricted slot only calls on its day',
      !A.staffCallSlot(friOnly, 6 * 3600 - 60, 3, 'npc_a'), 'wrong day');

    // Midnight wrap: an early slot called from late the previous evening resolves the
    // NEXT day's mask, not tonight's.
    const early = [{ ...slot, startTime: 60, days: 127 }];
    check('call time: the window wraps midnight', !!A.staffCallSlot(early, DAY - 60, 3, 'npc_a'), 'wrap');

    // A commercial break has no cast and must never pull anyone in.
    const adOnly = [{ ...slot, slotType: 'commercial_break' }];
    check('call time: a commercial break calls nobody', !A.staffCallSlot(adOnly, 6 * 3600 - 60, 3, 'npc_a'), 'ad break');
  }

  // ── Runtime tokens survive assembly ─────────────────────────────────────────
  // The couch talking to the actual audience only works if `{watching}` is still standing
  // when the line reaches the walker. Assembly-time fill must leave it alone and blank
  // everything else it doesn't know, or an authored line leaks a brace to air.
  {
    const A = _test;
    check('tokens: a runtime token survives assembly',
      A.talkshowFill('all {watching} of you', { temp: 3 }) === 'all {watching} of you',
      A.talkshowFill('all {watching} of you', { temp: 3 }));
    check('tokens: an unknown token is still blanked',
      A.talkshowFill('a {nonsense} b', { temp: 3 }) === 'a  b',
      JSON.stringify(A.talkshowFill('a {nonsense} b', { temp: 3 })));
    check('tokens: a known token still resolves at assembly',
      A.talkshowFill('{temp} degrees', { temp: 3 }) === '3 degrees',
      A.talkshowFill('{temp} degrees', { temp: 3 }));
    check('tokens: every runtime token is one the walker can fill',
      [...A.RUNTIME_TOKENS].every(k => k in A.scriptedTokens('ch_none', {}, {})),
      [...A.RUNTIME_TOKENS].join(','));
  }

  // ── The morning show is a running order, not a template ─────────────────────
  // The middle segments are shuffled and weighted per day, so two mornings differ in SHAPE.
  // Assembly must also stay deterministic within a day (every TV shows the same show) and
  // must never emit a raw `>>` (a speaker change spoken out loud) or an empty line.
  {
    const A = _test;
    const script = {
      host: 'npc_h', cohost: 'npc_c',
      pools: {
        open: ['Morning! >> Yes.'],
        couch: ['Sleep? >> No.'],
        weather: ['It is {temp}. >> It is.'],
        'weather.banner': ['WINDOW | X'],
        'beat.lead': ['{headline}. >> Mm.'],
        'beat.banner': ['BEAT | X'],
        segment: ['Tip. >> Noted.'],
        'segment.banner': ['HOTPLATE | X'],
        mailbag: ['A letter. >> Next.'],
        'mailbag.banner': ['MAILBAG | X'],
        'sportsdesk.baseball': ['{leader} at {leaderRecord}. >> Somebody has to be.'],
        'sportsdesk.hockey': ['{puckLeader} at {puckRecord}. >> On ice.'],
        'sportsdesk.banner': ['SLATE | X'],
        audience: ['All {watching} of you. >> {watching}.'],
        plug: ["{tonight} at {tonightTime}. >> It's on regardless."],
        'runin.clear': ['Clean boards. >> Write it down.'],
        'runin.banner': ['RUN-IN | X'],
        signoff: ["That's us. >> Same sunrise."],
        credits: ['SHOW'],
      },
    };
    const ctx = {
      env: { time: '06:10', tempC: 3, dayOfWeek: 3, season: 'winter', forecast: [{ tempC: 3, severity: 0 }, { tempC: 2, weatherType: 'snow' }], currentWeatherType: 'clear' },
      stories: [{ headline: 'A thing happened', body: 'b', byline: 'the wire' }],
      outages: 0, martialLaw: false, radiation: false,
      sports: { baseball: { team: 'Dynamo', record: '4-1' }, hockey: { team: 'Vig', record: '3-1-1' } },
      tonight: 'The Late Lot', tonightTime: '21:00',
    };
    const sayText = (g) => Object.values(g.nodes).filter(n => n.type === 'say').map(n => n.data.text);

    const g1 = A.assembleMorningGraph(script, 'bc_am', 'day-1', ctx);
    const again = A.assembleMorningGraph(script, 'bc_am', 'day-1', ctx);
    check('morning: the same day assembles the same show',
      JSON.stringify(sayText(g1)) === JSON.stringify(sayText(again)), 'determinism');

    // Shape variance across a week of buckets. Not every pair need differ, but a
    // shuffled+weighted running order must not produce one single shape all week.
    const shapes = new Set();
    for (let d = 1; d <= 14; d++) {
      const g = A.assembleMorningGraph(script, 'bc_am', `day-${d}`, ctx);
      shapes.add(sayText(g).join('|'));
      check(`morning: day ${d} speaks no raw speaker change`, !sayText(g).some(t => t.includes('>>')), 'raw >>');
      check(`morning: day ${d} speaks no empty line`, !sayText(g).some(t => !t.trim()), 'empty line');
      check(`morning: day ${d} still requires a present host`, g._requireHost === true, 'requireHost');
    }
    check('morning: the running order varies across the week', shapes.size > 1, `${shapes.size} shapes in 14`);

    // The live segments have to actually reach air, and carry their live facts.
    const week = [];
    for (let d = 1; d <= 14; d++) week.push(...sayText(A.assembleMorningGraph(script, 'bc_am', `day-${d}`, ctx)));
    check('morning: the sports desk reads the live table', week.some(t => /Dynamo at 4-1|Vig at 3-1-1/.test(t)), 'sportsdesk');
    check('morning: the couch plugs the network\'s own evening', week.some(t => t.includes('The Late Lot at 21:00')), 'plug');
    check('morning: the audience beat keeps its runtime token', week.some(t => t.includes('{watching}')), 'audience');

    // And each of those drops out cleanly when its live source is empty, rather than
    // reading a blank table or promising a programme that isn't on.
    const bare = { ...ctx, sports: {}, tonight: '', tonightTime: '' };
    const bareWeek = [];
    for (let d = 1; d <= 14; d++) bareWeek.push(...sayText(A.assembleMorningGraph(script, 'bc_am', `day-${d}`, bare)));
    check('morning: no sport played means no sports desk', !bareWeek.some(t => / at \./.test(t) || /^ at /.test(t)), 'empty table');
    check('morning: nothing on later means no plug', !bareWeek.some(t => t.includes(' at .')), 'empty plug');
    check('morning: the run-in is never dropped', bareWeek.some(t => t.includes('Clean boards')), 'runin always');
    check('morning: the sign-off is never dropped', bareWeek.some(t => t.includes("That's us")), 'signoff always');
  }

  // ── The shipped Coldwater A.M. content ──────────────────────────────────────
  // The pools are content, but two failures in them are invisible until air: a line with a
  // SECOND `>>` (splitExchange only cuts once, so the rest is spoken aloud) and a pool the
  // assembler asks for by name that isn't there.
  {
    const raw = JSON.parse(readFileSync(new URL('../../content/media_broadcasts/bc_coldwater_am.json', import.meta.url), 'utf8'));
    const pools = (typeof raw.morning_pools === 'string' ? JSON.parse(raw.morning_pools) : raw.morning_pools)?.pools || {};
    const lines = Object.entries(pools).flatMap(([k, v]) => (v || []).map(l => [k, l]));
    check('coldwater am: the pools are populated', lines.length > 100, String(lines.length));
    check('coldwater am: no line carries a second speaker change',
      !lines.some(([, l]) => (String(l).match(/>>/g) || []).length > 1),
      lines.filter(([, l]) => (String(l).match(/>>/g) || []).length > 1).map(([k]) => k).join(','));
    check('coldwater am: no line is blank', !lines.some(([, l]) => !String(l).trim()), 'blank');
    // Em dashes are an Ascendants/Architect voice tell and must not appear in station copy.
    check('coldwater am: no em dashes in station copy', !lines.some(([, l]) => String(l).includes('—')),
      lines.filter(([, l]) => String(l).includes('—')).map(([k]) => k).join(','));
    for (const pool of ['open', 'couch', 'weather', 'runin.clear', 'signoff', 'credits', 'segment', 'mailbag', 'audience', 'plug', 'sportsdesk.baseball', 'sportsdesk.hockey']) {
      check(`coldwater am: pool '${pool}' has lines`, (pools[pool] || []).length > 0, pool);
    }
    // The stand-by pool is what a viewer sees when the studio drops; empty means the bare
    // engine string, which is the thing that read as the station being dead.
    check('coldwater am: the channel has its own stand-by copy', (raw.fallback_messages || []).length > 0, String((raw.fallback_messages || []).length));

    // Authoring aid, off by default: `AM_DUMP=1 node tests/regress.js` prints three
    // consecutive mornings of the real shipped pools as they would go to air. The pools are
    // comedy and the running order is shuffled, so the only way to know whether a change
    // READS well (as opposed to merely assembling) is to look at three of them side by side.
    if (process.env.AM_DUMP) {
      const script = typeof raw.morning_pools === 'string' ? JSON.parse(raw.morning_pools) : raw.morning_pools;
      const ctx = {
        env: { time: '06:10', tempC: -4, feelsLikeC: -11, dayOfWeek: 2, season: 'winter', date: '2183-01-14',
               currentWeatherType: 'snow', forecast: [{ tempC: -4, weatherType: 'snow', severity: 1, windKph: 22, precipChance: 0.6 }, { tempC: -6, weatherType: 'blizzard' }] },
        stories: [{ headline: 'Ward clerk found alive in filing room', body: 'She had been there since Tuesday.', byline: 'the Sentinel' },
                  { headline: 'Lift 4 at the Solenne cleared for use', body: 'Again.', byline: 'the wire' }],
        outages: 0, martialLaw: false, radiation: false,
        sports: { baseball: { team: 'Norval Dynamo', record: '7-2' }, hockey: { team: 'Coldwater Vig', record: '5-2-1' } },
        tonight: 'The Last Lot', tonightTime: '21:00',
      };
      for (const day of ['2183-01-14', '2183-01-15', '2183-01-16']) {
        const g = _test.assembleMorningGraph(script, 'bc_coldwater_am', day, ctx);
        console.log(`\n──────── COLDWATER A.M. ${day} ────────`);
        for (const n of Object.values(g.nodes)) {
          if (n.type === 'say') console.log(`  ${n.data.text}`);
          else if (n.type === 'overlay') console.log(`  [${n.data.text}${n.data.subtext ? ' / ' + n.data.subtext : ''}]`);
          else if (n.type === 'ticker') console.log(`  >> ${n.data.text}`);
          else if (n.type === 'credits') console.log(`  (credits)`);
        }
      }
    }
  }
  // ── Tangents: losing the thread, on purpose ─────────────────────────────────
  // The delivery layer degrades a LINE; a tangent abandons the script for a run of
  // them. These cases guard the two things that would silently rot: a delivery
  // state added with no tangent voice (it would inherit nobody's, and the host
  // would simply never wander on that drug), and an authored character's own
  // obsessions being diluted by the house pool.
  {
    const states = Object.keys(TANGENT_POOLS);
    for (const st of states) {
      const runs = TANGENT_POOLS[st];
      check(`tangents: '${st}' has runs`, Array.isArray(runs) && runs.length > 0, st);
      check(`tangents: every '${st}' run is 2+ lines`, runs.every(r => Array.isArray(r) && r.length >= 2), st);
      check(`tangents: no blank line in '${st}'`, runs.every(r => r.every(l => String(l).trim())), st);
      // Em dashes are an Ascendants/Architect voice tell and must not appear in
      // anything a station host says.
      check(`tangents: no em dashes in '${st}'`, runs.every(r => r.every(l => !String(l).includes('—'))), st);
    }

    // A NEW DELIVERY STATE MUST DECIDE WHAT ITS TANGENT SOUNDS LIKE. Without this
    // case, adding a row to _DELIVERY gets you a state that degrades lines and can
    // never lose the thread, which reads as the feature being broken on that drug
    // rather than as an authoring gap. Two deliberate exemptions: `lucid` is
    // sharper than sober and does not wander, and `flee` never reaches a line at
    // all (it resolves through the collapse path).
    for (const st of Object.keys(_test.DELIVERY)) {
      if (st === 'lucid' || st === 'flee') continue;
      check(`tangents: delivery state '${st}' has a tangent voice`, canTangent(st), st);
    }

    // The house pools are read by WHOEVER is on the floor of whichever show. A
    // name in one is a character's dialogue wearing a generic pool's clothes.
    for (const reg of Object.keys(WRANGLE_POOLS)) {
      check(`tangents: house wrangle pool '${reg}' names nobody`,
        WRANGLE_POOLS[reg].every(l => !/(Neil|Nguyen|Akerson|Graham)/.test(l)), reg);
    }

    // ⚠ A TANGENT VOICE NOBODY CAN REACH. The floor was above 'wired' (0.4) and
    // 'comedown' (0.35), so a stimulant host had a pool written for him and never
    // once wandered — nothing errors, the feature is just silently off for him.
    for (const st of Object.keys(TANGENT_POOLS)) {
      check(`tangents: '${st}' can actually reach the floor`,
        _test.DELIVERY[st].level >= _test.TANGENT_FLOOR,
        `level ${_test.DELIVERY[st].level} < floor ${_test.TANGENT_FLOOR}`);
    }
    check('tangents: lucid never wanders', !canTangent('lucid'));
    check('tangents: an unknown state gets nothing', !canTangent('nonsense'));

    // Authored REPLACES the house pool, and the fallback chain is state → any →
    // house. A character with one bespoke drunk run must not be silently disabled
    // on every other state.
    const authored = { flags: { tangents: { loose: [['mine one', 'mine two']], any: [['catch all', 'second']] } } };
    check('tangents: authored replaces the house pool',
      tangentRuns(authored, 'loose')[0][0] === 'mine one');
    check("tangents: 'any' catches an unauthored state",
      tangentRuns(authored, 'mellow')[0][0] === 'catch all');
    check('tangents: an unauthored NPC still falls to the house pool',
      tangentRuns({ flags: {} }, 'loose').length === TANGENT_POOLS.loose.length);

    // The co-host half. Interleaved INSIDE the run (a producer who waits for the
    // end of the digression is not wrangling anyone), and the last beat is always
    // theirs and always a return to the running order.
    const host = { id: 'h', flags: { tangents: { loose: [['a', 'b', 'c', 'd']] } } };
    const cohost = { id: 'c', flags: {} };
    const withCo = buildTangent({ host, cohost, state: 'loose', rand: () => 0 });
    const solo = buildTangent({ host, cohost: null, state: 'loose', rand: () => 0 });
    check('tangents: solo run is host-only', solo.beats.every(b => b.who === 'host'));
    check('tangents: solo run airs every authored line', solo.beats.length === 4);
    check('tangents: a co-host interrupts inside the run',
      withCo.beats.some((b, i) => b.who === 'cohost' && i < withCo.beats.length - 1));
    check('tangents: the last beat is the co-host recovering the script',
      withCo.beats[withCo.beats.length - 1].who === 'cohost'
      && WRANGLE_POOLS.recover.includes(withCo.beats[withCo.beats.length - 1].text));
    check('tangents: an empty pool yields no tangent',
      buildTangent({ host: { id: 'x', flags: { tangents: { loose: [] } } }, cohost, state: 'nonsense' }) === null);

    // Hold is length-scaled and bounded — a four-word interjection must not sit on
    // screen as long as a sentence, and nothing may park the graph for a minute.
    check('tangents: a short beat holds less than a long one',
      tangentHoldMs('Neil.') < tangentHoldMs('x'.repeat(120)));
    check('tangents: hold is bounded', tangentHoldMs('x'.repeat(9999)) <= 7000);

    // The shipped cast. Neil is the character the feature was built for; if his own
    // voice is gone he silently falls back to the house pool and sounds like a
    // newsreader, which is exactly the gap this replaced.
    const neil = JSON.parse(readFileSync('content/npcs/npc_neil_mcmanistan.json', 'utf8'));
    const john = JSON.parse(readFileSync('content/npcs/npc_john_akerson.json', 'utf8'));
    const graham = JSON.parse(readFileSync('content/npcs/npc_graham_mercer.json', 'utf8'));
    const nguyen = JSON.parse(readFileSync('content/npcs/npc_captain_nguyen.json', 'utf8'));
    const phil = JSON.parse(readFileSync('content/npcs/npc_phil_mccracken.json', 'utf8'));
    check('tangents: Neil has his own drunk tangents', (neil.flags?.tangents?.loose || []).length > 0);
    check('tangents: Neil is in a state he can tangent from', canTangent('loose') && !!neil.flags?.booze_habit);
    for (const reg of ['early', 'late', 'recover']) {
      check(`tangents: Phil has '${reg}' wrangle lines`, (phil.flags?.wrangle_lines?.[reg] || []).length > 0);
      check(`tangents: Nguyen has '${reg}' lines too`, (nguyen.flags?.wrangle_lines?.[reg] || []).length > 0);
    }
    check('tangents: Phil replaces the house wrangle pool',
      wrangleLines(phil, 'recover')[0] !== WRANGLE_POOLS.recover[0]);


    // A run may declare what it is ABOUT, and the co-host answers the topic. Without
    // this, a producer with one good topical line reads it at random over every
    // tangent — 'nobody is watching this for your divorce' landing on a bit about
    // coffee, which is worse than the generic line it displaced.
    const topicHost = { id: 'h2', flags: { tangents: { loose: [{ lines: ['a', 'b'], topic: 'divorce' }] } } };
    const topicCo = { id: 'c2', flags: { wrangle_lines: { divorce: { recover: ['the divorce one'] }, recover: ['the general one'] } } };
    check('tangents: a topic-tagged run still airs its lines',
      buildTangent({ host: topicHost, cohost: topicCo, state: 'loose', rand: () => 0 }).beats[0].text === 'a');
    check('tangents: the co-host answers the topic',
      wrangleLines(topicCo, 'recover', 'divorce')[0] === 'the divorce one');
    check('tangents: an untagged run gets the general register',
      wrangleLines(topicCo, 'recover', null)[0] === 'the general one');
    check('tangents: a topic nobody wrote for falls back rather than going silent',
      wrangleLines(topicCo, 'recover', 'nothingness')[0] === 'the general one');
    check('tangents: a bare array run is still a valid run (no topic)',
      buildTangent({ host: { id: 'h3', flags: { tangents: { loose: [['x', 'y']] } } }, cohost: null, state: 'loose', rand: () => 0 }).topic === null);

    // Neil's runs and the floor's answers are authored as a pair; a topic with
    // nothing on the other side is legal (it falls back) but is almost always a typo.
    // EITHER man may own it, and which one is characterisation: Phil answers the
    // show, Nguyen answers his own root, and the one topic Phil will not engage with
    // he answers with the clock instead.
    for (const run of neil.flags.tangents.loose) {
      if (Array.isArray(run)) continue;
      check(`tangents: somebody on that floor answers '${run.topic}'`,
        !!(phil.flags?.wrangle_lines?.[run.topic] || nguyen.flags?.wrangle_lines?.[run.topic]), run.topic);
    }
    // ⚠ The tell. Phil has a topical answer for every one of Neil's obsessions, and
    // on the subject of the man he pushed out he talks about the RUNNING ORDER. If a
    // future edit gives him an actual opinion there, the joke is gone and nothing
    // else in the codebase would notice.
    check('tangents: Phil answers the Nguyen question with the clock',
      JSON.stringify(phil.flags.wrangle_lines.nguyen || {}).includes('running order')
      || JSON.stringify(phil.flags.wrangle_lines.nguyen || {}).includes('break'));
    check('tangents: ...and never once names him',
      !JSON.stringify(phil.flags.wrangle_lines.nguyen || {}).includes('Nguyen'));
    // Nguyen is not the foil any more. He is on a barstool. His job is to make it
    // worse, and the shape of that is that he owns exactly one subject.
    check('tangents: Nguyen owns the root and nothing else',
      Object.keys(nguyen.flags.wrangle_lines).filter(k => !['early', 'late', 'recover'].includes(k)).join() === 'root');

    // John Akerson is the OTHER failure: a stimulant host is launched rather than
    // lost, and his state ('wired') is the one the floor bug hid. His habit flag is
    // what puts him there, so the pair is asserted together.
    check('tangents: John has his own wired tangents', (john.flags?.tangents?.wired || []).length > 0);
    check('tangents: ...and a habit that actually reaches wired',
      !!john.flags?.preshow_habit || !!john.flags?.drug_habit, JSON.stringify(john.flags));
    check('tangents: ...and a comedown voice for the crash afterwards',
      (john.flags?.tangents?.comedown || []).length > 0);
    for (const run of [...(john.flags.tangents.wired || []), ...(john.flags.tangents.comedown || [])]) {
      if (Array.isArray(run)) continue;
      check(`tangents: Graham has something to say about '${run.topic}'`,
        !!graham.flags?.wrangle_lines?.[run.topic], run.topic);
    }
    // Authoring aid, off by default: `TANGENT_DUMP=1 node tests/regress.js` prints
    // one tangent per state as it would go to air, garbled at that state's own
    // level. The pools are comedy; assembling is not the same as reading well.
    if (process.env.TANGENT_DUMP) {
      const cast = { neil: { ...neil, id: 'npc_neil_mcmanistan' }, nguyen: { ...nguyen, id: 'npc_captain_nguyen' } };
      for (const st of Object.keys(TANGENT_POOLS)) {
        const useNeil = st === 'loose';
        const t = buildTangent({ host: useNeil ? cast.neil : { id: 'h', flags: {} }, cohost: cast.nguyen, state: st });
        if (!t) continue;
        const lvl = _test.DELIVERY[st].level;
        console.log(`\n──────── TANGENT: ${st} (level ${lvl})${useNeil ? ' — Neil, authored' : ''} ────────`);
        for (const b of t.beats) {
          const who = b.who === 'host' ? (useNeil ? 'Neil Mcmanistan' : 'The host') : 'Captain Nguyen';
          // The co-host is sober: his lines air clean while the host comes apart.
          const text = b.who === 'host' ? _test.garbleLine(b.text, lvl, st, useNeil ? cast.neil : null) : b.text;
          console.log(`  ${who} says, "${text}"`);
        }
      }
    }
  }
  // ── The call sheet sends people home ────────────────────────────────────────
  // An actor with lines gets a work-phased behaviour graph: the lifecycle shell with
  // his part spliced into the at-work branch. The shell is the whole point, and it
  // was missing — the graph ran HAVE_LIFE → GO_TO_WORK → the lines → loop, with
  // nothing anywhere asking whether the show was on. So Captain Nguyen stood in the
  // KSAB studio at every hour of the day reading You're Not Gonna Believe This Shit,
  // and the studio relay put it out over Raptor News, which airs from the same room
  // on the same channel at eight in the morning.
  //
  // Nothing about that reads as a scheduling fault when you see it — it reads as the
  // wrong man being cast in the news — which is why it is pinned on the SHAPE of the
  // graph rather than on any line of his.
  {
    const seq = [{ type: 'SAY', params: { message: 'CUT!' }, waitSecs: 5 }];
    const g = _test.buildWorkPhasedGraph(seq, 'zone_studio_x');
    const check_ = g.nodes[g._start] && g.nodes[g.nodes[g._start].next];
    check('call sheet: the graph asks whether the show is on before anything else',
      check_?.action_type === 'CHECK_WORK', JSON.stringify(g.nodes[g._start]));
    check('call sheet: the lines hang off the goToWork branch',
      g.nodes[check_?.goToWork]?.action_type === 'GO_TO_WORK');
    check('call sheet: ...and that branch is what reaches the part',
      g.nodes[g.nodes[check_?.goToWork]?.next]?.action_type === 'SAY');
    // The haveLife branch must go BACK to the check, never fall through to the
    // studio — a fall-through is the original bug wearing a condition's clothes.
    const life = g.nodes[check_?.haveLife];
    check('call sheet: off shift, HAVE_LIFE never falls through to the studio',
      life?.action_type === 'HAVE_LIFE' && g.nodes[life.next]?.type === 'loop', JSON.stringify(life));
    // No path from the start may reach GO_TO_WORK without passing the check.
    const reach = (id, seen = new Set()) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      const n = g.nodes[id];
      if (!n) return false;
      if (n.action_type === 'CHECK_WORK') return false;   // gated — stop here
      if (n.action_type === 'GO_TO_WORK') return true;
      return [n.next, n.goToWork, n.haveLife].some(x => reach(x, seen));
    };
    check('call sheet: there is no ungated route to the studio', !reach(g._start));
    // A cast member with no extractable lines gets the same shell — the AT_WORK
    // variant took the identical ungated path.
    const bare = _test.buildWorkPhasedGraph([], 'zone_studio_x');
    check('call sheet: ...and a wordless crew member is gated the same way',
      bare.nodes[bare.nodes[bare._start].next]?.action_type === 'CHECK_WORK');
  }
  // ── On location ─────────────────────────────────────────────────────────────
  // A show shot away from its channel's studio. Everything here guards a seam that
  // fails SILENTLY if it breaks: the cast walk to the wrong building and the show
  // reports that nobody turned up to a programme that is happening.
  {
    const src2 = readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8');
    const compile = new Function(`${src2}\n;return compileBsm;`)();
    const cooking = compile(readFileSync(new URL('../../data/scripts/cooking_shit_with_neil.bsm', import.meta.url), 'utf8'));
    check("location: the script declares where it's shot",
      cooking.meta.location === 'zone_stgarneau_basement', cooking.meta.location);
    check('location: ...and that zone exists', !!getZone('zone_stgarneau_basement'));
    check('location: the church basement is reachable from the world',
      !!getZone('zone_stgarneau_nave') && !!getZone('zone_district_925_912'));

    // ⚠ A BILLING IS NOT AN ALIAS. If this ever collapses, Neil starts airing as
    // "NEIL" in capitals and Jerry as "LAWYER", and nobody would think to look here.
    const anchors = Object.values(cooking.broadcastGraph.nodes).filter(n => n.type === 'npc_anchor');
    const billed = new Set(anchors.filter(n => n.display).map(n => n.npc_id));
    check('billing: the producer is billed', billed.has('npc_phil_mccracken'));
    check('billing: ...and he is billed as PRODUCER',
      anchors.find(n => n.npc_id === 'npc_phil_mccracken')?.display === 'PRODUCER');
    check('billing: an ordinary @alias is NOT a billing',
      !billed.has('npc_neil_mcmanistan') && !billed.has('npc_father_jerome'),
      [...billed].join(','));

    // The uplink. A studio is wired; a church basement is not, so the deck is the
    // difference between a location shoot and a room with cameras in it.
    const studioState = { studioZoneId: 'zone_studio_1782953094650' };
    check('uplink: a wired studio needs no deck',
      _test.uplinkOk(studioState, 'zone_studio_1782953094650') === true);
    check('uplink: the church basement has a portable deck',
      _test.uplinkOk(studioState, 'zone_stgarneau_basement') === true);
    check("uplink: ...and a room with no deck can't reach the studio",
      _test.uplinkOk(studioState, 'zone_stgarneau_nave') === false);

    // ── The keyholder's pre-show act ────────────────────────────────────────
    // Generic seam: whoever owns the building does an authored thing when a crew
    // turns up to film in it. Everything here guards a silent failure — an act
    // that fires on every tick, or in the wrong room, or never.
    const jer = JSON.parse(readFileSync('content/npcs/npc_father_jerome.json', 'utf8'));
    const act = jer.flags?.preshow_act;
    check('act: the keyholder has one', !!act);
    check('act: it names the STAGE it watches', act?.stage === 'zone_stgarneau_basement', act?.stage);
    // ⚠ The room the act happens in is NOT the room the show is made in. Authoring
    // one field for both puts a man unscrewing a plaque over the front door into a
    // basement kitchen, which is where this started before it was two fields.
    check('act: ...and the ROOM it happens in, separately', act?.zone === 'zone_district_925_912', act?.zone);
    check('act: the two are different rooms', act.stage !== act.zone);
    check('act: it has both halves', (act.before || []).length > 0 && (act.after || []).length > 0);
    check('act: the doorway it plays in exists', !!getZone(act.zone));
    check('act: ...and still says nothing about why',
      !/protest|defian|resist|statement/i.test(JSON.stringify(act)));

    // ⚠ THE STAGE IS BOOKED NOW, so its call state depends on the GAME CLOCK and
    // asserting a value here would go red every Tuesday morning and nowhere else.
    // What is deterministic is the shape: it always answers one of the three, and a
    // zone nothing is staged in always answers idle.
    check('act: a booked location answers a real state',
      ['idle', 'call', 'air'].includes(_test.locationCallState(act.stage)),
      _test.locationCallState(act.stage));
    check('act: a zone nothing is staged in is idle', _test.locationCallState('zone_stgarneau_nave') === 'idle');
    check('act: no stage at all is idle', _test.locationCallState(null) === 'idle');
    // Edge-triggered: the tick must be a no-op when nothing has changed, and must
    // not throw with no players about.
    _test.preshowActTick();
    _test.preshowActTick();
    check('act: ticking an idle world twice is a no-op', true);

    // The slot that makes all of it real. Without a booking the location seam, the
    // droids and the plaque are all correct and all dormant.
    const slot = JSON.parse(readFileSync('content/media_channel_playlist/stgarneau-tue-1100.json', 'utf8'));
    check('slot: the show is booked', slot.broadcast_id === 'bc_cooking_shit_neil', slot.broadcast_id);
    // "They film on a Tuesday" is a line Father Jerome says. Bit 1 is Tuesday, and
    // this row is the only thing that makes that sentence true rather than flavour.
    check('slot: ...on a Tuesday, which is what he tells you', slot.days === 2, String(slot.days));
    const staff = slot.conditions?.npc_staff || [];
    check('slot: the host is dispatched', staff.includes('npc_neil_mcmanistan'));
    check('slot: the producer is dispatched', staff.includes('npc_phil_mccracken'));
    // ⚠ THE DROIDS BEING ON THIS LIST IS THE ONLY REASON THE BASEMENT HAS A PICTURE.
    // Drop them and the show airs to a dark room and resolves as technical
    // difficulties, which looks like an engine fault and is a casting mistake.
    check('slot: ...and so are the cameras',
      staff.includes('npc_ksab_droid_1') && staff.includes('npc_ksab_droid_2'), staff.join(','));
    // The AUTHORED call sheet does not dispatch the keyholder — he lives there and he
    // is not crew. ⚠ Note the boot-time staffing self-heal DOES merge every anchored
    // actor into npc_staff on a live channel, so the runtime list is longer than this
    // one; what is asserted here is who we deliberately send, not who ends up listed.
    check("slot: the authored sheet doesn't dispatch the keyholder",
      !staff.includes('npc_father_jerome'));
    // ⚠ A crew member who works in more than one building must not carry a fixed
    // work_zone_id: GO_TO_WORK prefers it over the per-slot lookup, so a pinned studio
    // sends the producer to KSAB on the Tuesday and his lines come out of an empty room.
    const philRow = JSON.parse(readFileSync('content/npcs/npc_phil_mccracken.json', 'utf8'));
    check('slot: the producer is routed by the call sheet, not by a pinned studio',
      !philRow.work_zone_id, String(philRow.work_zone_id));
    // Neil is the case the rule was written for and the one that broke it: he fronts
    // the basement cookery show AND a studio show, so he is called to two buildings
    // and can hold neither. The staffing pass used to write his work_zone_id with a
    // COALESCE, which pinned him to whichever slot reconciled first (the basement)
    // and then preserved it for ever.
    const neilRow = JSON.parse(readFileSync('content/npcs/npc_neil_mcmanistan.json', 'utf8'));
    check('slot: the host works in two buildings, so he is pinned to neither',
      !neilRow.work_zone_id, String(neilRow.work_zone_id));

    // The programme and its channel are read once here, ahead of both blocks
    // below. The `acted` checks were written later and landed above the
    // declarations they borrow, which is a TDZ, not a missing file.
    const bc = JSON.parse(readFileSync('content/media_broadcasts/bc_cooking_shit_neil.json', 'utf8'));
    const chan = JSON.parse(readFileSync(`content/media_channels/${bc.channel_id}.json`, 'utf8'));

    // ── Performed, not printed ─────────────────────────────────────────────
    // Both Neil shows are made by NPCs standing in a room, on a channel that is a
    // `playlist`. Without `acted` the only way to say so is to flip KSAB to a live
    // channel, which would presence-gate all 28 of its slots — six films and two
    // ball games included — on a cast that does not exist.
    const studioShow = JSON.parse(readFileSync('content/media_broadcasts/bc_1783047001982.json', 'utf8'));
    check('acted: the cookery show is performed', bc.acted === true, String(bc.acted));
    check('acted: ...and so is the studio show', studioShow.acted === true, String(studioShow.acted));
    check('acted: the studio show names no location, so it plays in the channel studio',
      !studioShow.location_zone_id, String(studioShow.location_zone_id));
    // Which is precisely what makes Neil a two-building employee: same channel, same
    // host, two different stages. If these ever resolve to one zone this whole block
    // stops testing anything.
    check("acted: ...and that's a different room from the basement",
      (studioShow.location_zone_id || chan.studio_zone_id) !== bc.location_zone_id);
    // A recording is not a performance. A drama names its actors with npc_anchor too,
    // so gating one on its cast being awake would take it off the air.
    const recording = JSON.parse(readFileSync('content/media_broadcasts/bc_1782872045373.json', 'utf8'));
    check("acted: an ordinary broadcast isn't acted by default", !recording.acted, String(recording.acted));

    check("slot: the broadcast knows where it's shot", bc.location_zone_id === 'zone_stgarneau_basement', String(bc.location_zone_id));
    check("slot: ...and it's the zone the keyholder watches", bc.location_zone_id === act.stage);
    // ⚠ THE CHANNEL NOW HAS A STUDIO, AND THE LOCATION STILL HAS TO WIN.
    //
    // This used to assert the opposite — channel 11 was studio-less, so every stage
    // decision fell through to the programme's own location by default and nothing
    // had to prefer one over the other. The show moved to KSAB, which has a real
    // studio across town, and that turned a fallback into a genuine contest: the
    // seam is only load-bearing now BECAUSE there is something for it to beat.
    // Get this backwards and the cast are called to KSAB on the Tuesday while the
    // programme films in a church basement, and their lines come out of an empty
    // room. Same failure the old assertion guarded, one rung harder to reach.
    check('slot: the show now airs on a channel that HAS a studio of its own',
      !!chan.studio_zone_id, String(chan.studio_zone_id));
    check('slot: ...and the shoot still beats it', bc.location_zone_id !== chan.studio_zone_id);
    check('slot: ...which is the rule the engine applies',
      (bc.location_zone_id || chan.studio_zone_id) === 'zone_stgarneau_basement');
    check('slot: the title card exists as a graphic',
      !!JSON.parse(readFileSync('content/media_graphics/daily_bread_logo.json', 'utf8')).content);

    // ── The chain that gets a picture out of a church basement ──────────────
    // Each link fails silently on its own, so each one is asserted on its own.
    for (const id of ['npc_ksab_droid_1', 'npc_ksab_droid_2']) {
      const d = JSON.parse(readFileSync(`content/npcs/${id}.json`, 'utf8'));
      check(`droid ${id}: is a camera`, !!d.flags?.camera_droid);
      check(`droid ${id}: lives at the studio it's sent out from`, !!d.home_zone);
      // ⚠ A FIELD UNIT HAS NO FIXED PLACE OF WORK. GO_TO_WORK resolves
      // params → work_zone_id → studio_zone_id → the call sheet, so a pinned zone
      // WINS and the unit can only ever serve one location for the rest of its life.
      check(`droid ${id}: is routed by the call sheet, not pinned`, !d.work_zone_id, String(d.work_zone_id));
      check(`droid ${id}: ...and its graph doesn't pin one either`,
        !d.behaviour_graph?.nodes?.n_work?.params?.zone_id);
      check(`droid ${id}: walks to work`, d.behaviour_graph?.nodes?.n_work?.action_type === 'GO_TO_WORK');
      // Broadcast staffing runs off the playlist, not vendor_schedule, so a window
      // wider than the show is a contradiction nothing reads. Keep them agreeing.
      const days = Object.entries(d.vendor_schedule || {}).filter(([, v]) => v.length).map(([k]) => k);
      check(`droid ${id}: works the day the show films`, days.join(',') === 'tue', days.join(','));
    }

    // TRANSMISSION IS NOT PRESENCE. The gate that used to be switched off for every
    // scheduled programme — which meant the kit was scenery on exactly the channel it
    // was built for.
    check('transmission: the church basement can currently go out',
      _test.camerasIn('zone_stgarneau_basement').length > 0
      && _test.uplinkOk({ studioZoneId: null }, 'zone_stgarneau_basement'));
    check('transmission: ...because there are cameras in it',
      _test.camerasIn('zone_stgarneau_basement').length >= 2,
      String(_test.camerasIn('zone_stgarneau_basement').length));
    check('transmission: ...and a deck to get the signal home',
      _test.uplinkOk({ studioZoneId: null }, 'zone_stgarneau_basement'));
    // Take the deck away and the show is off the air, whatever the schedule says.
    {
      const furn = getZoneFurniture('zone_stgarneau_basement') || [];
      const deck = furn.find(f => f?.flags?.portable_mediadeck);
      check('transmission: the deck is a real object in the room', !!deck);
      if (deck) {
        deck.flags.deck_off = true;
        check('transmission: switching it off takes the channel down',
          _test.uplinkOk({ studioZoneId: null }, 'zone_stgarneau_basement') === false);
        delete deck.flags.deck_off;
        check('transmission: ...and switching it back on heals it',
          _test.uplinkOk({ studioZoneId: null }, 'zone_stgarneau_basement') === true);
      }
    }
    // The channel's own wired studio never needs one — that is what wired means.
    check('transmission: a wired studio is exempt',
      _test.uplinkOk({ studioZoneId: 'zone_studio_1782953094650' }, 'zone_studio_1782953094650') === true);

    // A PORTABLE DECK IS A TRANSMITTER. The gallery going dark used to take the
    // channel off air even while the crew were out with a working case — the one
    // situation the case exists for.
    {
      const KSAB = 'ch_7_1782953079593';
      const BASEMENT = 'zone_stgarneau_basement';
      const furn = getZoneFurniture(BASEMENT) || [];
      const deck = furn.find(f => f?.flags?.portable_mediadeck);
      check('transmitter: the basement case is live', _test.portableDeckLive(BASEMENT) === true);
      check("transmitter: an empty room isn't a transmitter",
        _test.portableDeckLive('zone_studio_1782953094650') === false);
      // No wired deck at all (or its room blacked out) and the case still answers.
      check('transmitter: a bound portable keeps the channel on air with no wired deck',
        _test.channelTransmitterLive({ deckZoneId: null, portableDeckZones: [BASEMENT] }) === true);
      check("transmitter: ...and an unbound channel isn't carried by it",
        _test.channelTransmitterLive({ deckZoneId: null, portableDeckZones: [] }) === false);
      if (deck) {
        deck.flags.deck_off = true;
        check('transmitter: switching the case off takes the channel down',
          _test.channelTransmitterLive({ deckZoneId: null, portableDeckZones: [BASEMENT] }) === false);
        delete deck.flags.deck_off;
      }

      // ⚠ The power clause used to read `furniture.is_powered`, a column furniture
      // has never had — so it was `undefined !== 0` and could not fail. Assert the
      // predicate actually depends on the switch, which is now the only lever
      // either test can pull in a room with no power zone.
      check('transmitter: the case is live again once the switch is back on',
        _test.portableDeckLive(BASEMENT) === true);
      check('transmitter: no furniture row means no transmitter',
        _test.portableDeckLive('zone_nonexistent_room') === false);

      // uplink: the switch is reachable from a command, which is the whole point.
      // Nothing but this suite could write deck_off before it existed.
      const player = getPlayer();
      const savedZone = player.current_zone;
      {
        // ⚠ Re-read the row every time. updateFurniture re-caches the RETURNING row,
        // which REPLACES the object in world.furniture — a reference held from before
        // the command is a stale copy and would assert against the old flags.
        const deckNow = () => (getZoneFurniture(BASEMENT) || []).find(f => f?.flags?.portable_mediadeck);
        player.current_zone = BASEMENT;
        const before = !!deckNow()?.flags?.deck_off;
        const r0 = await run('uplink');
        check('uplink: reports the case in the room', /mediadeck|pairing lights/i.test(r0?.message || ''), JSON.stringify(r0));
        const r1 = await run('uplink off');
        check('uplink: switches it off', !!deckNow()?.flags?.deck_off === true, JSON.stringify(r1));
        check('uplink: ...and the channel loses it',
          _test.portableDeckLive(BASEMENT) === false);
        const r2 = await run('uplink off');
        check("uplink: switching it off twice isn't an error", /already off/i.test(r2?.message || ''), JSON.stringify(r2));
        await run('uplink on');
        check('uplink: switches it back on', !deckNow()?.flags?.deck_off);
        check('uplink: ...and the channel has it back',
          _test.portableDeckLive(BASEMENT) === true);
        if (before) await run('uplink off');   // leave the room as we found it
      }
      player.current_zone = savedZone;
      const elsewhere = await run('uplink off');
      check('uplink: says so in a room with no case',
        /no portable mediadeck/i.test(elsewhere?.message || ''), JSON.stringify(elsewhere));
      // The binding is real content, not a test fixture: KSAB's own runtime must
      // carry the basement, or the fallback above can never fire in the live game.
      const st = _test.channelRuntime?.get?.(KSAB);
      if (st) check('transmitter: KSAB knows about its portable case',
        (st.portableDeckZones || []).includes(BASEMENT),
        JSON.stringify(st.portableDeckZones || []));
    }

    // ── A camera direction is an order ──────────────────────────────────────
    // The label is the order sheet, so the parse is load-bearing: get it wrong and
    // every cut silently falls back to "any unit, generic line".
    check('order: a cut names its unit and its shot',
      _test.shotOrder('CAM — 3 — FOLLOW to the pantry door').unit === '3'
      && _test.shotOrder('CAM — 3 — FOLLOW to the pantry door').verb === 'follow');
    check('order: an underscored shot reads as words',
      _test.shotOrder('CAM — 1 — SNAP_TIGHT on Neil McManistan').verb === 'snap tight');
    check('order: an unparseable label commands nobody',
      _test.shotOrder('something else').unit === null);
    // Every cut in the shipped script is an order somebody can be given.
    {
      const bc = JSON.parse(readFileSync('content/media_broadcasts/bc_cooking_shit_neil.json', 'utf8'));
      const cuts = Object.values(bc.broadcast_graph.nodes).filter(n => n.type === 'camera_cut');
      check('order: the show has cuts', cuts.length > 0, String(cuts.length));
      const unreadable = cuts.filter(n => _test.shotOrder(n.label).unit === null).map(n => n.label);
      check('order: every cut in the show parses', unreadable.length === 0, unreadable.join(' | '));
      check('order: every cut names a zone that exists',
        cuts.every(n => !n.zone_id || !!getZone(n.zone_id)),
        cuts.filter(n => n.zone_id && !getZone(n.zone_id)).map(n => n.zone_id).join(','));
    }

    // The dispatch itself. A droid is the direction made physical, so a cut to a
    // room it is not in has to MOVE it — and has to fail honestly when it cannot.
    {
      const fakeState = { playlist: [{ npcStaff: ['npc_ksab_droid_1', 'npc_ksab_droid_2'] }] };
      const d1 = world.npcs.get('npc_ksab_droid_1');
      const home = d1?.zone_id;
      check('dispatch: the unit is somewhere to begin with', !!home, String(home));
      // ⚠ Put the crew ON LOCATION first. Off shift they are sitting at the studio,
      // and the studio is a city away — which is the case the hop cap exists for, and
      // is why the first cut of these tests only passed by sending a camera droid on
      // a cross-town walk in the middle of a programme.
      for (const id of ['npc_ksab_droid_1', 'npc_ksab_droid_2']) moveNpcToZone(id, 'zone_stgarneau_basement');
      // A room that already has a camera needs nobody sent to it.
      check('dispatch: a covered room needs no dispatch',
        _test.dispatchDroid('zone_stgarneau_basement', 'zone_stgarneau_basement', 'CAM — 1 — WIDE on the counter', fakeState) === true);
      // The pantry is next door and has no camera of its own: the order moves a unit.
      const before = _test.camerasIn('zone_stgarneau_pantry').length;
      const moved = _test.dispatchDroid('zone_stgarneau_pantry', 'zone_stgarneau_basement', 'CAM — 3 — FOLLOW to the pantry door', fakeState);
      check('dispatch: an uncovered room gets a unit sent to it', moved === true);
      check("dispatch: ...and it's physically there now",
        _test.camerasIn('zone_stgarneau_pantry').length === before + 1,
        String(_test.camerasIn('zone_stgarneau_pantry').length));
      // ⚠ THE NAMED UNIT IS TAKEN FIRST. A script that numbers its cameras is
      // describing a crew and should get the crew it describes.
      const d2 = world.npcs.get('npc_ksab_droid_2');
      const both = [world.npcs.get('npc_ksab_droid_1'), d2];
      check('dispatch: the script gets the unit it asked for',
        both.some(d => d && d.zone_id === 'zone_stgarneau_pantry'));
      // Put everyone back where they were before the next case looks.
      for (const d of both) if (d) moveNpcToZone(d.id, 'zone_stgarneau_basement');
      check('dispatch: units are back on the stage',
        _test.camerasIn('zone_stgarneau_pantry').length === before);
      // Nowhere to go: an order nobody can execute is refused rather than faked.
      // A connected world means almost everywhere is technically reachable, so the
      // rule that matters is DISTANCE: a camera direction moves a unit around a
      // location, it does not send it across the city mid-programme.
      check('dispatch: a room across the city is refused',
        _test.dispatchDroid('zone_asc_shrine_nave', 'zone_stgarneau_basement', 'CAM — 1 — WIDE on nothing', fakeState) === false);
      check("dispatch: a zone that doesn't exist is refused",
        _test.dispatchDroid('zone_nonexistent_xyz', 'zone_stgarneau_basement', 'CAM — 1 — WIDE', fakeState) === false);
      check('dispatch: with no crew, nobody is sent',
        _test.dispatchDroid('zone_stgarneau_pantry', 'zone_stgarneau_basement', 'CAM — 1 — WIDE', { playlist: [] }) === false);
    }

    // ── Waiting for somebody who is not coming ──────────────────────────────
    // The people who DID turn up used to stand in total silence while a stand-by
    // card went out over them.
    for (const id of ['npc_neil_mcmanistan', 'npc_phil_mccracken', 'npc_captain_nguyen',
                      'npc_father_jerome', 'npc_graham_mercer', 'npc_john_akerson']) {
      const d = JSON.parse(readFileSync(`content/npcs/${id}.json`, 'utf8'));
      const lines = d.flags?.absent_lines || [];
      check(`absent: ${d.name} has something to say about it`, lines.length >= 3, String(lines.length));
      check(`absent: ${d.name}'s lines aren't blank`, lines.every(l => String(l).trim()));
      // ⚠ The token is what makes it about a PERSON rather than about a delay. At
      // least one line each has to name whoever it is they are waiting on.
      check(`absent: ${d.name} names the person`, lines.some(l => l.includes('{missing}')));
      check(`absent: ${d.name} doesn't use an em dash`, lines.every(l => !l.includes('—')));
    }
    // Six characters, six reactions: if any two pools share a line, somebody has been
    // copy-pasted and the whole point of authoring them separately is gone.
    {
      const all = [];
      for (const id of ['npc_neil_mcmanistan', 'npc_phil_mccracken', 'npc_captain_nguyen',
                        'npc_father_jerome', 'npc_graham_mercer', 'npc_john_akerson']) {
        all.push(...(JSON.parse(readFileSync(`content/npcs/${id}.json`, 'utf8')).flags?.absent_lines || []));
      }
      check('absent: nobody shares a line with anybody else', new Set(all).size === all.length,
        `${all.length - new Set(all).size} duplicate(s)`);
      check('absent: the house pool exists for everyone unauthored', _test.ABSENT_HOUSE.length > 0);
      check('absent: ...and it names the person too',
        _test.ABSENT_HOUSE.some(l => l.includes('{missing}')));
    }
    // Edge-triggered: one voice per absence, or a character beat becomes a fault.
    {
      const graph = { nodes: {
        a: { type: 'npc_anchor', data: { npc_id: 'npc_neil_mcmanistan' } },
        b: { type: 'npc_anchor', data: { npc_id: 'npc_phil_mccracken' } },
      } };
      const z = getZone('zone_stgarneau_basement');
      const had = new Set(z.npcs);
      z.npcs.add('npc_neil_mcmanistan');           // present
      z.npcs.delete('npc_phil_mccracken');         // missing
      const bb = {};
      _test.absentReaction(graph, 'zone_stgarneau_basement', bb);
      check('absent: somebody speaks up', bb.absentSpoke === true);
      const bb2 = { absentSpoke: true };
      _test.absentReaction(graph, 'zone_stgarneau_basement', bb2);
      check("absent: ...and doesn't keep saying it", bb2.absentSpoke === true);
      // An empty stage has nobody in it to react.
      const bb3 = {};
      _test.absentReaction(graph, 'zone_stgarneau_pantry', bb3);
      check('absent: an empty room says nothing', !bb3.absentSpoke);
      z.npcs.clear(); for (const id of had) z.npcs.add(id);
    }

    // Camera droids are cameras. This is the whole integration, so if it regresses
    // the location goes dark and resolves as "technical difficulties" forever.
    const before = _test.camerasIn('zone_stgarneau_pantry').length;
    const droid = { id: 'regress-droid', name: 'test unit', hp: 5, flags: { camera_droid: true }, zone_id: 'zone_stgarneau_pantry' };
    world.npcs.set(droid.id, droid);
    const pantry = getZone('zone_stgarneau_pantry');
    pantry.npcs = pantry.npcs || new Set();
    pantry.npcs.add(droid.id);
    check('droid: a camera droid IS a working camera in the room it stands in',
      _test.camerasIn('zone_stgarneau_pantry').length === before + 1);
    droid.hp = 0;
    check('droid: ...a downed one is not', _test.camerasIn('zone_stgarneau_pantry').length === before);
    droid.hp = 5; droid._ai = { dosedOut: true };
    check('droid: ...nor is one somebody has jammed',
      _test.camerasIn('zone_stgarneau_pantry').length === before);
    pantry.npcs.delete(droid.id);
    world.npcs.delete(droid.id);
    check('droid: a droid that leaves takes the picture with it',
      _test.camerasIn('zone_stgarneau_pantry').length === before);
  }

  // ── Game nights at the park ─────────────────────────────────────────────────
  // The light towers follow the show that plays there: every tile of a venue's block answers
  // venue.lit while it's on air, nothing does once it's off, and the map derive puts it on the cell.
  {
    const { venueLit, refreshVenueLights } = _test;
    const chans = [{ script: { venue: { site: { block: { x0: 895, x1: 897, y0: 911, y1: 913 } } } } }];
    refreshVenueLights(chans);
    check('venue lights: every tile of the block is lit while its show is on', venueLit({ x: 895, y: 911 })?.on === 1 && venueLit({ x: 897, y: 913 })?.on === 1);
    check('venue lights: a tile off the block is not', venueLit({ x: 898, y: 912 }) === undefined);
    const { deriveSurfaceCell } = await import('../flight/state.js');
    const z = getZone('zone_ballpark_896_912');
    if (z && typeof deriveSurfaceCell === 'function') {
      check('venue lights: the derive puts the game night on the park cell', deriveSurfaceCell(z, 896, 912).vl === 1);
      check('venue lights: a static bake never bakes one in', deriveSurfaceCell(z, 896, 912, undefined, false).vl === 0);
    }
    refreshVenueLights([]);
    check('venue lights: off air, the towers go dark', venueLit({ x: 896, y: 912 }) === undefined);
    if (z && typeof deriveSurfaceCell === 'function') check('venue lights: and the cell says so', deriveSurfaceCell(z, 896, 912).vl === 0);
  }
  // The roof follows today's forecast, not the sky: wet forecast shut, dry open, and a staff call
  // holds over the forecast until it's handed back. The forecast is handed in, so the check doesn't
  // depend on the day the suite happens to boot on.
  {
    const { venueRoof, refreshVenueRoofs, _roofState, setVenueRoof } = _test;
    const saved = new Map(_roofState);
    const t0 = Date.now();
    try {
      _roofState.clear();
      refreshVenueRoofs(t0, false, () => true);
      check('venue roof: shut on a wet forecast, every tile of the park', venueRoof({ x: 895, y: 911 })?.shut === 1 && venueRoof({ x: 897, y: 913 })?.shut === 1);
      check('venue roof: a tile off the park has no roof', venueRoof({ x: 898, y: 912 }) === undefined);
      refreshVenueRoofs(t0 + 60e3, false, () => false);
      check('venue roof: open on a dry forecast', venueRoof({ x: 896, y: 912 })?.shut === 0);
      setVenueRoof('shut', t0 + 61e3);
      refreshVenueRoofs(t0 + 62e3, false, () => false);
      check('venue roof: a staff call holds over a dry forecast', venueRoof({ x: 896, y: 912 })?.shut === 1);
      setVenueRoof('auto', t0 + 63e3);
      refreshVenueRoofs(t0 + 64e3, false, () => false);
      check('venue roof: and auto hands it back to the forecast', venueRoof({ x: 896, y: 912 })?.shut === 0);
      // and each Gameday line airs with it, so the broadcast's park has its shells where the map's are
      // (gl/ballpark.js setRoof); a script whose site names no block has no roof to send
      const sited = { _venueSite: { x: 897.55, y: 913.55, mid: { x: 896, y: 912 } } };
      check('venue roof: a Gameday line airs with the roof open', _test.gamedayOnAir({ kind: 'single' }, sited).roof === 0);
      check('venue roof: …and with no block, no roof', !('roof' in _test.gamedayOnAir({ kind: 'single' }, { _venueSite: { x: 897.55, y: 913.55 } })));
      const { deriveSurfaceCell } = await import('../flight/state.js');
      const z = getZone('zone_ballpark_896_912');
      if (z && typeof deriveSurfaceCell === 'function') {
        check('venue roof: the derive puts an open roof on the park cell', deriveSurfaceCell(z, 896, 912).vr === 0);
        check('venue roof: a static bake shows it shut', deriveSurfaceCell(z, 896, 912, undefined, false).vr === 1);
      }
      refreshVenueRoofs(t0 + 22 * 60e3, false, () => true);
      check('venue roof: and shuts again on a wet forecast', venueRoof({ x: 896, y: 912 })?.shut === 1);
      check('venue roof: …and the next Gameday line airs with it shut', _test.gamedayOnAir({ kind: 'single' }, { _venueSite: { x: 897.55, y: 913.55, mid: { x: 896, y: 912 } } }).roof === 1);
    } finally {
      setVenueRoof('auto'); _roofState.clear(); for (const [k, v] of saved) _roofState.set(k, v);
      refreshVenueRoofs(Date.now(), false);
    }
  }
}
