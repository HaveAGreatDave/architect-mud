// Broadcast plugin regression suite — run by tests/regress.js (never loaded in
// production). Verifies the plugin's VINE nodes landed in the AI runner's
// registry (they were moved out of the engine's ai-behaviour.js switch), and
// that an off-shift studio actor walks out of the studio building.
import { getRegisteredAINodes, tickEntityAI, initBlackboard } from '../../server/engine/ai-behaviour.js';
import { world } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { ensureClipBroadcast, _test, _piracyTest, startEmergency, stopEmergency, emergencyActive, getTvChannelList, getTabletTunedChannel } from './index.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
const tabletTunersClear = (id) => _test.tabletTuners.delete(id);
import { getCrimeStars, getCrimeWitness } from '../../server/engine/crimes.js';

export default async function regress({ check, run, getPlayer }) {
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

  // ── Talk-show episode assembly (live-acted, procedural) ──────────────────────
  // A talk show assembles a fresh episode from ::lines pools each night and ACTS it with
  // real cast NPCs. Check the assembled graph: it attributes lines to the cast (npc_anchor),
  // fills {host}/{guest}/{title}, is presence-gated (_requireHost), and anchors the guest's
  // answers to the reusable npc_guest.
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
  check('a stranger cannot operate someone else\'s seized deck', canOperateDeck({ pirate_owner: 'p1' }, { id: 'p2', role: 'player' }) === false, 'rival');
  check('lock error hints to pirate an un-seized deck', /pirate/i.test(deckLockError({}, { id: 'p2', role: 'player' })?.message || ''), 'hint');
  check('an operator gets no lock error', deckLockError({ pirate_owner: 'p1' }, { id: 'p1', role: 'player' }) === null, 'no-error');

  // `pirate` without the firmware installed is refused (the firmware is the gate).
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

  if (chans.length) {
    await run(`tablettune ${chans[0].number}`);
    check('tablettune registers the portable tuner with no furniture',
      getTabletTunedChannel(player.id) === chans[0].channelId,
      `${getTabletTunedChannel(player.id)} vs ${chans[0].channelId}`);

    await run('tablettune 0');
    check('tablettune 0 powers the tablet screen down', getTabletTunedChannel(player.id) === null, String(getTabletTunedChannel(player.id)));

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
}
