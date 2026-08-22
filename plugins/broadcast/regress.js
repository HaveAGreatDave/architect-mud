// Broadcast plugin regression suite — run by tests/regress.js (never loaded in
// production). Verifies the plugin's VINE nodes landed in the AI runner's
// registry (they were moved out of the engine's ai-behaviour.js switch), and
// that an off-shift studio actor walks out of the studio building.
import { readFileSync, readdirSync } from 'fs';
import { getRegisteredAINodes, tickEntityAI, initBlackboard } from '../../server/engine/ai-behaviour.js';
import { world, getZone, getZoneFurniture, moveNpcToZone } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { ensureClipBroadcast, _test, _piracyTest, startEmergency, stopEmergency, emergencyActive, getTvChannelList, getTabletTunedChannel, isDeckInputChannel } from './index.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
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
  const c = _test.sportsGameForSlot(script, 12346, null);
  check('a different slot rolls a different game',
    a.game.away.name !== c.game.away.name || a.game.home.name !== c.game.home.name || a.game.awayScore !== c.game.awayScore || a.game.homeScore !== c.game.homeScore,
    'adjacent slots differ');

  // A round-robin round has every team exactly once (balanced schedule, not random).
  const rounds = _test.roundRobinRounds(8);
  check('round-robin: N-1 rounds', rounds.length === 7, String(rounds.length));
  const seen = new Set(rounds[0].flat());
  check('round-robin: every team plays once per round', rounds[0].length === 4 && seen.size === 8, JSON.stringify(rounds[0]));

  // A matchup is a real pairing of two distinct teams from the roster.
  const m = _test.sportsMatchupForSlot(999, script.teams);
  check('matchup picks two distinct roster teams', m && m.away !== m.home && script.teams.includes(m.away) && script.teams.includes(m.home), JSON.stringify(m));

  // Featured-slot airing gate: no airSlots ⇒ continuous; an out-of-range set ⇒ dark now,
  // a full-range set ⇒ always airing (whatever the current slot-of-day is).
  check('no airSlots airs continuously', _test.sportsAiring({}) === true && _test.sportsAiring({ airSlots: [] }) === true, 'continuous');
  const allSlots = Array.from({ length: _test.SPORTS_GAMES_PER_DAY }, (_, i) => i);
  check('featuring every slot always airs', _test.sportsAiring({ airSlots: allSlots }) === true, 'all-slots');
  check('featuring no valid slot never airs', _test.sportsAiring({ airSlots: [-1] }) === false, 'empty-window');

  // World Series airtime: the Series is pinned to the NEXT nightly @airtime slot (so it airs
  // — and is advertised in the news/TV guide — at the fixed evening time), not "the next hour".
  const G = _test.SPORTS_GAMES_PER_DAY;   // 8 → slot-of-day 6 == the 18:00–21:00 block
  const fromMorning = _test.nextAirSlot(40 * G + 0, [6], G);   // start of a day (slot-of-day 0)
  check('WS pins to tonight\'s evening slot', fromMorning.slot % G === 6 && fromMorning.hour === 18, JSON.stringify(fromMorning));
  const fromEvening = _test.nextAirSlot(40 * G + 6, [6], G);   // seeded DURING the evening block
  check('WS seeded at the evening slot rolls to the next night', fromEvening.slot === 41 * G + 6 && fromEvening.hour === 18, JSON.stringify(fromEvening));
  check('continuous league (no airSlots) uses the next slot', _test.nextAirSlot(100, null, G).slot === 101, JSON.stringify(_test.nextAirSlot(100, null, G)));

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
    guests: [{ name: 'Lucky Malone', title: 'a lottery winner', theme: '' }, { name: 'Dr. Vane', title: 'a mad surgeon', theme: '' }],
    title: 'tonight_show_logo', theme: 'tonight_theme',
    pools: {
      open: ['It is the show!'], tease: ['Tonight, chaos.'], announce_host: ['Here is {host}!'],
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
        prompt: ['What is it worth?'],
        stall: ['Take your time.'],
        reveal: ['The floor said {guesses}. The card says {price}.'],
        'reveal.lot': ['{guesses}. It goes {order}.'],
        showcase_reveal: ['The lot comes to {price}. Bids were {guesses}.'],
        verdict_read: ['{verdict} That is {purse} credits.'],
        audience: ['The audience makes a noise.'],
        applause: ['Applause.'],
        commercial: ['Sponsored by ACID COLA.'],
        signoff: ['That is the last lot.'],
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
      'pass counter did not roll or did not reset');

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
      _test.getGameshowSubject('no_such_subject_at_all').id === 'retail', 'unknown subject did not fall back');
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
      'tie did not go to the first answer');

    // The material. These pools are the whole reason the subject is affordable — they
    // read the boot-loaded registries and nothing else.
    const T2 = _test.gameshowTest;
    const districts = T2.districtPool();
    const orders = T2.orderPool();
    check('gameshow: the basin subject has districts to ask about', districts.length >= 3, String(districts.length));
    check('gameshow: every district question has authored copy behind it',
      districts.every(d => d.name && String(d.blurb).trim()), 'a district reached the pool with no blurb');
    check('gameshow: only NPC orders are quotable — a player corp is not general knowledge',
      orders.every(o => o.name && String(o.creed).trim()), 'an order reached the pool with no creed');
    check('gameshow: the material pools are sorted, so an episode is reproducible',
      districts.every((d, i) => i === 0 || districts[i - 1].id <= d.id), 'district pool is not id-sorted');

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
      'runin.blackout': ['{outages} blocks are dark. >> Do not trust the stairwell.'],
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
  check('a stranger cannot operate an un-seized deck', canOperateDeck({}, { id: 'p2', role: 'player' }) === false, 'stranger');
  // A consumer deck is an appliance, not a transmitter: whoever is in the room works
  // it. Without this a resident can't put a tape in their own machine, and the
  // SPECTER cam patch (which reuses the same gate) would be unreachable.
  check('anyone present can operate a consumer deck', canOperateDeck({ mini_deck: true }, { id: 'p2', role: 'player' }) === true, 'mini-deck');
  check('a consumer deck stays operable even while pirated by someone else',
    canOperateDeck({ mini_deck: true, pirate_owner: 'p1' }, { id: 'p2', role: 'player' }) === true, 'mini-deck+pirate');
  check('a stranger cannot operate someone else\'s seized deck', canOperateDeck({ pirate_owner: 'p1' }, { id: 'p2', role: 'player' }) === false, 'rival');
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

        state.lastBeat = { text: 'And we are back.', style: 'raw', programName: 'The Regress Hour', duration: 6, hasGameday: false, graphic: null };
        _test.sendCatchUp(player.id, cid);
        const beat = got.find(m => m?.type === 'broadcast');
        check('tuning replays the beat already on air', beat?.message === 'And we are back.', JSON.stringify(got.slice(0, 2)));
        check('the replay is flagged catchUp (so it is not re-narrated)', beat?.catchUp === true, JSON.stringify(beat));
        check('the replay carries the program name', beat?.programName === 'The Regress Hour', JSON.stringify(beat));

        got.length = 0;
        state.lastBeat = { text: '>> headline <<', style: 'ticker' };
        _test.sendCatchUp(player.id, cid);
        check('a ticker beat is not replayed', got.length === 0, JSON.stringify(got.slice(0, 2)));

        // A stale score-bug must never be painted over whatever is on now.
        got.length = 0;
        state.lastBeat = { text: 'Line.', style: 'raw', programName: null, duration: null, hasGameday: false, graphic: null };
        state.lastScorebug = { overlayType: 'scorebug', sport: 'baseball' };
        state.lastScorebugAt = Date.now() - 10 * 60 * 1000;
        _test.sendCatchUp(player.id, cid);
        check('a stale score-bug is not replayed', !got.some(m => m?.overlay?.overlayType === 'scorebug'), JSON.stringify(got));
        // One gesture can register a viewer two or three times (the client's lock check
        // races the server echo), which used to replay the same line each time.
        got.length = 0;
        _test.sendCatchUp(player.id, cid);
        check('the same beat is not replayed twice to one viewer', got.length === 0, JSON.stringify(got));

        state.lastScorebugAt = Date.now();
        got.length = 0;
        state.lastBeat = { text: 'Next line.', style: 'raw', programName: null, duration: null, hasGameday: false, graphic: null };
        _test.sendCatchUp(player.id, cid);
        check('a live score-bug IS replayed', got.some(m => m?.overlay?.overlayType === 'scorebug'), JSON.stringify(got));
      } finally {
        setBroadcast(orig3);
        state.lastBeat = savedBeat;
        delete state.lastScorebug; delete state.lastScorebugAt;
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

  // ── Live-text {token} substitution for scripted broadcasts ──────────────────
  // The Quiet Hour (and any scripted graph) may embed {clock}/{weather}/{viewers}/…
  // which resolve at airtime. Guard the safety properties: no-brace text is untouched,
  // unknown tokens are left verbatim, known tokens resolve, and {viewers} reflects the
  // real live tune-in count (minus the set the line is addressing), not a fake number.
  {
    const bb = {};
    const st2 = { channelId: 'ch_does_not_exist' };
    check('subTokens leaves brace-free text untouched',
      _test.subTokens('There is nothing on.', st2.channelId, st2, bb) === 'There is nothing on.', 'plain text changed');
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
    check('anyCastPresent is false for a zone that does not exist',
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
    check('someone who is not in the show is not held by it',
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
    const anyVoiced = { flags: { delivery_lines: { any: { fumbles: ['— hah —'] } } } };
    let sawAny = false;
    for (let i = 0; i < 80; i++) if (_test.garbleLine(line, 0.9, 'mellow', anyVoiced).includes('— hah —')) sawAny = true;
    check("an 'any' pool reaches a state it does not name", sawAny, 'the catch-all never fired');

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
      'airSlots did not select the right show');
    check('no taping outside any show’s block',
      A.showingAt(state, 100 * G + 0, G) === null && A.showingAt(state, 100 * G + 5, G) === null,
      'a pre-recorded rerun was mistaken for a live house');
    check('a pre-recorded playlist never opens a house',
      A.showingAt({ playlist: [rerun] }, 12345, G) === null, 'clips are not tapings');
    check('an acted show with no airSlots is continuous',
      A.showingAt({ playlist: [{ playback_mode: 'talkshow', talkshowScript: {} }] }, 12345, G) !== null,
      'no airSlots should mean every block');

    // The slot IS the date — that is what makes yesterday's pass worthless
    // without a calendar being stored anywhere.
    const slotA = 100 * G + 7, slotB = 101 * G + 7;
    check('the same block on two days is two different showings', slotA !== slotB, 'slot index is not self-dating');
    check('a slot resolves to the in-game calendar date it falls on',
      A.dateForSlot(slotA, G) === new Date(100 * 86400000).toISOString().slice(0, 10)
      && A.dateForSlot(slotB, G) !== A.dateForSlot(slotA, G),
      A.dateForSlot(slotA, G));

    // The instance key is what stops two passes to two different nights merging
    // into one row and laundering the wrong date onto the survivor.
    check('a stamped pass never stack-merges',
      rowIsInstanced({ custom_data: { show_pass: { slot: slotA } } }) === true, 'show_pass is not an instance key');
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
        'exegesis.prime': ['There is no cruelty in it.'],
        'exegesis.duc': ['I counted. Fourteen.'],
        'exegesis.halm': ['This is IT.'],
        'exegesis.warning': ['Take this as the tap on the shoulder it is.'],
        exegesis: ['The flesh was only ever an interval.'],
        'interjection.duc': ['Fourteen.'], interjection: ['Hold there a moment.'],
        amen: ['So it routes.'],
        'testimony.lead': ['We have a witness.'], testimony: ['It does not hurt.'],
        hymn: ['♪ We were the load. ♪'],
        tithe: ['The Order takes no money at the door.'],
        homily: ['You have spent this week resenting a thing that does not know your name.'],
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
    check('film: a runtime of exactly one block does not over-reserve',
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
    check('film: the second block does not rewind the picture — the run wraps midnight',
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
    check('film: reserved blocks exceed the runtime (there is always a tail)',
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

    // PIN THE SEASON PHASE. `sportsSlotLabel` takes a World Series branch when one
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

      const puck = L(mkItem('hockey'));
      const ball = L(mkItem('baseball'));
      check('guide: a hockey slot is captioned CLUSTER PUCK, never DEADBALL',
        /^CLUSTER PUCK — /.test(puck || '') && !/DEADBALL/.test(puck || ''), String(puck));
      check('guide: a baseball slot is still captioned DEADBALL',
        /^DEADBALL — /.test(ball || ''), String(ball));

      // …and the branch that used to break it, now asserted on purpose: a pending
      // final outranks the regular caption, per sport, without leaking across.
      setPhase('baseball', { phase: 'worldseries', finalistA: 'Static Saints', finalistB: 'Bunker Hill Bruisers' });
      const wsBall = L(mkItem('baseball'));
      check('guide: a pending World Series outranks the DEADBALL caption',
        /WORLD SERIES — Static Saints vs Bunker Hill Bruisers/.test(wsBall || ''), String(wsBall));
      check('guide: …and a baseball final never re-captions the hockey slot',
        /^CLUSTER PUCK — /.test(L(mkItem('hockey')) || ''), String(L(mkItem('hockey'))));
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
    let goals = 0, faceoffs = 0, centreDrops = 0, periods = 0, lines = 0, gamesPlayed = 0;
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
      const say = (line, tok, sb, graphic, gd) => {
        if (!line) return;
        lines++;
        const text = sportsFill(line, tok).trim();
        if (/\{[a-zA-Z]/.test(text)) unfilled.push(text);
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

    check('hockey: goals cross the goal line', notCrossed.length === 0, `${notCrossed.length} short: ${notCrossed.slice(0, 3).join(',')}`);
    check('hockey: no unfilled tokens reach the air', unfilled.length === 0, unfilled.slice(0, 3).join(' | '));
    check('hockey: scorers belong to a club that played', strayScorers.length === 0, strayScorers.slice(0, 3).join(','));
    check('hockey: the narrator produced play-by-play', lines > 100, `${lines} lines`);
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
      const game = HOCKEY.simGame(matchup, players, sportsRng(seed),
        opts.unavailable ? { unavailable: opts.unavailable } : undefined);
      const nrng = sportsRng(seed ^ 0x9e3779b9);
      const pick = (...keys) => { for (const k of keys) if (pools[k]?.length) { usedPools.add(k); break; } return sportsPick(pools, nrng, ...keys); };
      HOCKEY.narrate({
        script: {}, game, gs: { seed, game }, slot, ws: !!opts.ws, announcer: 'Tug Brennan',
        pools, nrng, sport: HOCKEY, add: () => {}, say: (l, t) => { if (l) { const x = sportsFill(l, t); if (/\{[a-zA-Z]/.test(x)) unfilled.push(x); } }, pick,
        abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
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
      if (g.rivalry) sawRivalry = true;
    }
    check('hockey: overtime happens and is narratable', sawOt, 'no OT game found in 4000 slots');
    check('hockey: the shootout happens and is narratable', sawSo, 'no shootout found in 4000 slots');
    check('hockey: a man can die on the ice', sawDeath, 'no fatality found in 4000 slots');
    // Rivalry is asserted DIRECTLY rather than hunted: this suite's synthetic pairing
    // (home = 7i+5) can never coincide with the league's rivalry pairing, so waiting for
    // one to turn up would only ever test the arithmetic. Build the grudge match instead.
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
    // A club whose BARN has authored chatter, so chatter.<club> is exercised. The
    // synthetic pairing above never makes these clubs the home side.
    for (const barn of ['Ashway Zambonis', 'Docks Boarders', 'Longwatch Goons']) {
      if (teams.includes(barn)) narrateSlot(13, { matchup: { away: teams.find(t => t !== barn), home: barn, teams } });
    }
    // The Cup: a final is the same sim with `ws`, which unlocks the cup.* pools.
    narrateSlot(11, { ws: true, matchup: { away: teams[0], home: teams[1], teams } });

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
      const { reservePool, icedRoster, INJURY_MAX_SLOTS } = await import('./sports/hockey.js');
      const reserve = reservePool(teams, players);
      check('hockey: there is a reserve to call up from', reserve.length > 0, `${reserve.length} spare men`);
      const rostered = new Set();
      for (const t of teams) for (const n of rosterFor(t, teams, players)) rostered.add(n);
      check('hockey: the reserve is nobody\'s first-choice six', reserve.every(n => !rostered.has(n)), 'overlap');

      // A club missing men still ices six, and the replacements are marked.
      const club = teams[0];
      const base = rosterFor(club, teams, players);
      const dressed = icedRoster(club, teams, players, new Set([base[0], base[3]]));
      check('hockey: a depleted club still ices six', dressed.length === 6, String(dressed.length));
      check('hockey: the injured men are not dressed', !dressed.some(d => d.name === base[0] || d.name === base[3]), dressed.map(d => d.name).join(','));
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
            const heal = c.dead ? Number.MAX_SAFE_INTEGER : slot + Math.max(1, c.slotsOut || 1);
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
      check('hockey: the league does not saturate with injuries', a.peak <= 40, `peak ${a.peak} of ${teams.length * 6}`);
      const durations = [];
      for (let slot = 0; slot < 200; slot++) {
        const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
        if (matchup.away === matchup.home) continue;
        const g = HOCKEY.simGame(matchup, players, sportsRng(sportsHash(slot, 0)));
        for (const c of g.casualties) if (!c.dead) durations.push(c.slotsOut);
      }
      check('hockey: an injury carries a duration', durations.length > 0 && durations.every(d => d >= 1 && d <= INJURY_MAX_SLOTS),
        `${durations.length} injuries, max ${Math.max(0, ...durations)}`);

      // Baseball must be untouched by all of this — its sim ignores the fourth argument.
      const bb = _test.sportsGameForSlot({ teams: ['A', 'B', 'C', 'D'], players: [], pools: {} }, 99, null);
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
    check('deadball: a walk is not an at-bat', cole.ab === 4, `ab=${cole.ab} (walk+sacfly must be excluded from 6)`);
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
      check('gameday: …and naming who is batting', halves.every(g => g.battingTeam && g.inningOrd && (g.half === 'top' || g.half === 'bottom')), 'half payload is missing its framing');
      check('gameday: at-bat payloads are untouched by all this', atbats.length > 0 && atbats.every(g => Array.isArray(g.pitches)), `${atbats.length} at-bat payloads`);
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
    check('call time: the open slot is not the call window', !S(6 * 3600), 'at airtime');
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
        plug: ['{tonight} at {tonightTime}. >> It is on regardless.'],
        'runin.clear': ['Clean boards. >> Write it down.'],
        'runin.banner': ['RUN-IN | X'],
        signoff: ['That is us. >> Same sunrise.'],
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
    check('morning: the sign-off is never dropped', bareWeek.some(t => t.includes('That is us')), 'signoff always');
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
  // ── On location ─────────────────────────────────────────────────────────────
  // A show shot away from its channel's studio. Everything here guards a seam that
  // fails SILENTLY if it breaks: the cast walk to the wrong building and the show
  // reports that nobody turned up to a programme that is happening.
  {
    const src2 = readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8');
    const compile = new Function(`${src2}\n;return compileBsm;`)();
    const cooking = compile(readFileSync(new URL('../../data/scripts/cooking_shit_with_neil.bsm', import.meta.url), 'utf8'));
    check('location: the script declares where it is shot',
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
    check('uplink: ...and a room with no deck cannot reach the studio',
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
    check('slot: the authored sheet does not dispatch the keyholder',
      !staff.includes('npc_father_jerome'));
    // ⚠ A crew member who works in more than one building must not carry a fixed
    // work_zone_id: GO_TO_WORK prefers it over the per-slot lookup, so a pinned studio
    // sends the producer to KSAB on the Tuesday and his lines come out of an empty room.
    const philRow = JSON.parse(readFileSync('content/npcs/npc_phil_mccracken.json', 'utf8'));
    check('slot: the producer is routed by the call sheet, not by a pinned studio',
      !philRow.work_zone_id, String(philRow.work_zone_id));

    const bc = JSON.parse(readFileSync('content/media_broadcasts/bc_cooking_shit_neil.json', 'utf8'));
    check('slot: the broadcast knows where it is shot', bc.location_zone_id === 'zone_stgarneau_basement', String(bc.location_zone_id));
    check('slot: ...and it is the zone the keyholder watches', bc.location_zone_id === act.stage);
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
    const chan = JSON.parse(readFileSync(`content/media_channels/${bc.channel_id}.json`, 'utf8'));
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
      check(`droid ${id}: lives at the studio it is sent out from`, !!d.home_zone);
      // ⚠ A FIELD UNIT HAS NO FIXED PLACE OF WORK. GO_TO_WORK resolves
      // params → work_zone_id → studio_zone_id → the call sheet, so a pinned zone
      // WINS and the unit can only ever serve one location for the rest of its life.
      check(`droid ${id}: is routed by the call sheet, not pinned`, !d.work_zone_id, String(d.work_zone_id));
      check(`droid ${id}: ...and its graph does not pin one either`,
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
      check('dispatch: ...and it is physically there now',
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
      check('dispatch: a zone that does not exist is refused',
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
      check(`absent: ${d.name}'s lines are not blank`, lines.every(l => String(l).trim()));
      // ⚠ The token is what makes it about a PERSON rather than about a delay. At
      // least one line each has to name whoever it is they are waiting on.
      check(`absent: ${d.name} names the person`, lines.some(l => l.includes('{missing}')));
      check(`absent: ${d.name} does not use an em dash`, lines.every(l => !l.includes('—')));
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
      check('absent: ...and does not keep saying it', bb2.absentSpoke === true);
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
}
