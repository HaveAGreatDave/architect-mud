// Tablet OS plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player's id matches no players row, so DB writes are
// no-ops; this asserts routing + payload shape, not real data.
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { world } from '../../server/engine/world.js';
import { _test as news } from './news-generator.js';
import { _test as calendar } from './calendar-app.js';

export default async function regress({ run, check, getPlayer }) {
  let r = await run('tablet');
  check('tablet verb opens home screen', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));
  check('home screen carries player summary', !!r?.player && typeof r.player.credits === 'number', JSON.stringify(r?.player));
  check('home screen lists apps', Array.isArray(r?.apps) && r.apps.length >= 9, `apps=${r?.apps?.length}`);
  check('home screen apps include quests/skills/bank/vehicles/properties/settings/corp/specter',
    ['quests', 'skills', 'bank', 'vehicles', 'properties', 'settings', 'corp', 'specter']
      .every(id => r.apps.some(a => a.id === id)),
    JSON.stringify(r?.apps?.map(a => a.id)));

  r = await run('os');
  check('os verb aliases tablet', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));

  // Nav into each simple app's root screen — asserts buildScreen doesn't throw
  // and returns a recognizable view.
  for (const appId of ['skills', 'bank', 'crafting', 'vehicles', 'properties', 'settings', 'corp']) {
    r = await run(`tabletnav ${appId}`);
    check(`tabletnav ${appId} routes to app`, r?.type === 'tablet_panel' && r?.screen === 'app' && r?.appId === appId, JSON.stringify(r));
    check(`tabletnav ${appId} has no error`, !r?.error, r?.error);
  }

  // Crafting app: root is a list of known recipes (skill-gated). The fake player
  // knows none, but the screen must still route as a list view with no error.
  r = await run('tabletnav crafting');
  check('crafting app root is a list view', r?.type === 'tablet_panel' && r?.appId === 'crafting' && r?.view === 'list' && !r?.error, JSON.stringify(r)?.slice(0, 200));

  // Quests app: category root (no rows for the fake player, but must not error).
  r = await run('tabletnav quests');
  check('tabletnav quests routes', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r));
  check('quests root is category view', r?.view === 'categories', JSON.stringify(r));

  // Help app: root is the chapter index (categories); a chapter opens the reader
  // (help view) with sections; the Commands chapters carry the real /help groups.
  r = await run('tabletnav help');
  check('help app root is category view', r?.type === 'tablet_panel' && r?.appId === 'help' && r?.view === 'categories', JSON.stringify(r)?.slice(0, 200));
  check('help root lists chapters', Array.isArray(r?.items) && r.items.some(it => it.id === 'basics') && r.items.some(it => it.id === 'gear'), JSON.stringify(r?.items?.map(i => i.id)));
  r = await run('tabletnav help gear');
  check('help chapter opens the reader view', r?.view === 'help' && !!r?.chapter, JSON.stringify(r)?.slice(0, 200));
  check('help chapter carries command sections', Array.isArray(r?.chapter?.sections) && r.chapter.sections.some(s => s.heading === 'COMBAT'), JSON.stringify(r?.chapter?.sections?.map(s => s.heading)));
  r = await run('tabletnav help nonsense_chapter');
  check('help unknown chapter errors cleanly', r?.view === 'error', JSON.stringify(r)?.slice(0, 120));

  // Unknown app id falls back to home rather than erroring.
  r = await run('tabletnav nonexistent_app_xyz');
  check('tabletnav unknown app falls back to home', r?.screen === 'home', JSON.stringify(r));

  // Settings app renders natively (Tablet's own theme picker, not the full
  // game settings panel) — client-side, so the server side is just the signal.
  r = await run('tabletnav settings');
  check('settings app signals tablet_settings view', r?.view === 'tablet_settings', JSON.stringify(r));

  // Corp app now renders natively (reshapes plugins/corps' own
  // buildConsolePayload()). The fake player has no corp membership, so this
  // exercises the founding screen (cost warning + name prompt), not an error.
  r = await run('tabletnav corp');
  check('corp app (no membership) shows the founding screen', r?.view === 'corp_found', JSON.stringify(r));
  check('founding screen states the one-time fee', typeof r?.foundFee === 'number' && r.foundFee > 0, JSON.stringify(r));

  // Corp Territory Map sub-screen: cmdCorpMap works with or without a corp, so
  // even the no-membership fake player gets a corp_map view + a tiles array.
  r = await run('tabletnav corp map');
  check('corp map sub-screen signals corp_map view', r?.view === 'corp_map' && Array.isArray(r?.tiles), JSON.stringify(r)?.slice(0, 200));
  check('corp map sub-screen has no error', !r?.error, r?.error);

  // Ideology app: read-only reshape of the ideologies/rep command data. Renders
  // natively (view: 'ideology'); all pages ride in one payload the client pages
  // through. The fake player has no rep, so every order sits at the base tier.
  r = await run('tabletnav ideology');
  check('ideology app is registered on the home screen', (await run('tablet'))?.apps?.some(a => a.id === 'ideology'), 'ideology app missing from roster');
  check('ideology app signals ideology view', r?.type === 'tablet_panel' && r?.appId === 'ideology' && r?.view === 'ideology', JSON.stringify(r)?.slice(0, 160));
  // Count-agnostic: the four canon orders must be present and live (not tagged
  // expansion). Expansion orders may or may not be imported locally, so assert
  // presence of the canon set rather than an exact length.
  const canonLive = ['ideology_ascendants', 'ideology_long_watch', 'ideology_wildblood', 'ideology_exodus'];
  check('ideology payload carries the live canon orders', Array.isArray(r?.orders) && canonLive.every(id => r.orders.some(o => o.id === id && !o.expansion)), `orders=${r?.orders?.length}`);
  check('ideology payload carries the tier ladder', Array.isArray(r?.tiers) && r.tiers.length === 6, `tiers=${r?.tiers?.length}`);
  check('ideology overview carries stance + paths', r?.overview && typeof r.overview.stance === 'number' && !!r.overview.paths, JSON.stringify(r?.overview));
  check('ideology orders carry standing + profile + expansion fields', r?.orders?.every(o => o.id && o.color && typeof o.rep === 'number' && 'stance' in o && 'path' in o && 'expansion' in o && Array.isArray(o.opposed)), JSON.stringify(r?.orders?.[0])?.slice(0, 200));

  // Map app: the tablet-native city map. Reuses buildMapPayload, so the root
  // resolves to a map view with a tiles array + mode; the unified zoom ladder
  // (z<n> args) widens the tile window until it saturates into the regional view.
  r = await run('tabletnav map');
  check('map app routes to a map view', r?.type === 'tablet_panel' && r?.appId === 'map' && r?.view === 'map', JSON.stringify(r)?.slice(0, 200));
  check('map app carries tiles + mode with no error', Array.isArray(r?.tiles) && typeof r?.mode === 'string' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  check('map app reports the zoom ladder (zoomLevel + maxZoom)', typeof r?.zoomLevel === 'number' && typeof r?.maxZoom === 'number' && r.maxZoom >= 1, JSON.stringify({ z: r?.zoomLevel, m: r?.maxZoom }));
  const z0Count = r?.tiles?.length || 0;
  r = await run('tabletnav map z1');
  check('map app z1 is a wider window than z0', r?.view === 'map' && r?.mode === 'zone' && r?.zoomLevel === 1 && (r?.tiles?.length || 0) >= z0Count, JSON.stringify({ z0: z0Count, z1: r?.tiles?.length }));
  r = await run('tabletnav map regional');
  check('map app regional is the terminal zoom stop', r?.view === 'map' && r?.mode === 'regional' && r?.zoomLevel === r?.maxZoom, JSON.stringify({ v: r?.view, z: r?.zoomLevel, m: r?.maxZoom }));

  // Calendar app: root is a month-grid calendar view leading with a weeks grid and
  // an agenda list beneath it (led by the "today" marker), carrying a new-reminder
  // action. Adding a +N reminder persists to player_flags, then shows in the agenda
  // list and gets a marker dot on its grid day; drilling in (client sends the
  // breadcrumb as screenId + the id as params) opens a detail with a delete action;
  // delete removes it. Prev/next month arrows re-nav to a 'YYYY-MM' via screenId 'month'.
  const cal = getPlayer();
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [cal.id, 'calendar_reminders']);
  r = await run('tabletnav calendar');
  check('calendar app routes to a calendar view', r?.type === 'tablet_panel' && r?.appId === 'calendar' && r?.view === 'calendar' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  check('calendar view carries a weeks grid + month nav', Array.isArray(r?.weeks) && r.weeks.length > 0 && /^\d{4}-\d{2}$/.test(r?.prevMonth || '') && /^\d{4}-\d{2}$/.test(r?.nextMonth || ''), JSON.stringify({ w: r?.weeks?.length, p: r?.prevMonth, n: r?.nextMonth }));
  check('calendar agenda leads with the today marker', r?.items?.[0]?.id === 'today', JSON.stringify(r?.items)?.slice(0, 200));
  check('calendar view offers a new-reminder action', Array.isArray(r?.actions) && r.actions.some(a => a.id === 'add' && a.prompt), JSON.stringify(r?.actions)?.slice(0, 200));

  // A month nav (screenId 'month' + a 'YYYY-MM' token) returns that month's grid.
  r = await run('tabletnav calendar month 2099-01');
  check('month nav returns the requested month grid', r?.view === 'calendar' && /Janufizz 2099/.test(r?.monthLabel || ''), JSON.stringify({ v: r?.view, m: r?.monthLabel }));

  r = await run('tabletaction calendar add 2099-01-01 Regress reminder');
  check('adding a dated reminder returns the calendar (no error)', r?.appId === 'calendar' && r?.view === 'calendar' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  const remItem = r?.items?.find(it => String(it.id).startsWith('rem_'));
  check('the new reminder shows in the calendar agenda', !!remItem && /Regress reminder/.test(remItem.label), JSON.stringify(r?.items)?.slice(0, 240));

  // Drill in the way the client does: `tabletnav calendar <breadcrumb> <id>`.
  r = await run(`tabletnav calendar Calendar ${remItem?.id}`);
  check('opening a reminder routes to a detail with a delete action', r?.view === 'detail' && r?.actions?.some(a => a.id === 'del'), JSON.stringify(r)?.slice(0, 200));

  r = await run(`tabletaction calendar del ${remItem?.id}`);
  const stillThere = (r?.items || []).some(it => it.id === remItem?.id);
  check('deleting a reminder removes it from the agenda', r?.view === 'calendar' && !stillThere, JSON.stringify(r?.items)?.slice(0, 200));

  r = await run('tabletaction calendar add nodatehere just some text');
  check('a reminder with no leading date errors cleanly', r?.view === 'error', JSON.stringify(r)?.slice(0, 160));
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [cal.id, 'calendar_reminders']);

  // Day-of ping selection (dueReminders): fires today/overdue & unfired only.
  {
    const today = '2087-07-13';
    const list = [
      { id: 'a', date: '2087-07-20', text: 'future' },
      { id: 'b', date: '2087-07-13', text: 'today' },
      { id: 'c', date: '2087-07-01', text: 'overdue' },
      { id: 'd', date: '2087-07-01', text: 'already pinged', fired: true },
    ];
    const due = calendar.dueReminders(list, today).map(r => r.id).sort();
    check('dueReminders fires today + overdue, skips future + already-fired', JSON.stringify(due) === JSON.stringify(['b', 'c']), JSON.stringify(due));
    check('dueReminders is empty with no game date', calendar.dueReminders(list, null).length === 0);
  }

  // Surveillance (SPECTER) app: the fake player hasn't installed SPECTER, so the
  // hub screen is the locked state (view surveillance, live:false); installing it
  // (the flag the hack-deck program sets) unlocks the live hub. Microreels is the
  // install-free list path (empty, no error). All must route without throwing.
  const sp = getPlayer();
  await setFlag('player', 'specter_installed', '0', sp);
  r = await run('tabletnav specter');
  check('specter app routes to a surveillance view', r?.type === 'tablet_panel' && r?.appId === 'specter' && r?.view === 'surveillance', JSON.stringify(r)?.slice(0, 200));
  check('specter hub is locked until SPECTER is installed', r?.locked === true && r?.live !== true, JSON.stringify(r)?.slice(0, 200));
  await setFlag('player', 'specter_installed', '1', sp);
  r = await run('tabletnav specter');
  check('specter hub unlocks once SPECTER is installed', r?.view === 'surveillance' && r?.locked !== true && r?.live === true, JSON.stringify(r)?.slice(0, 200));
  await setFlag('player', 'specter_installed', '0', sp);
  r = await run('tabletnav specter chips');
  check('specter microreels is a list view with no error', r?.view === 'list' && !r?.error && Array.isArray(r?.items), JSON.stringify(r)?.slice(0, 200));

  // Microreels are possession-gated: a reel is the datachip you carry. Seed a clip
  // row + its datachip in the player's kit; a reel opens the app's OWN inline viewer
  // (view: reel).
  const REEL_ID = 'clip_regress_tablet';
  const CHIP_ID = `item_datachip_${REEL_ID}`;
  await query('DELETE FROM security_clips WHERE id=$1', [REEL_ID]);
  await query('DELETE FROM player_inventory WHERE item_id=$1', [CHIP_ID]);
  await query('DELETE FROM items WHERE id=$1', [CHIP_ID]);
  await query(
    `INSERT INTO security_clips (id, device_id, zone_id, owner_id, frames, captured_at, crime_tags)
     VALUES ($1,'dev_x','zone_x',$2,$3,0,'[]')`,
    [REEL_ID, sp.id, JSON.stringify([{ t: '00:00:00', text: 'Kaz says hi', kind: 'say' }, { t: '00:00:05', text: 'Vann leaves', kind: 'event' }])]
  );
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,'Datachip — Regress','','evidence',60,40,$2) ON CONFLICT (id) DO NOTHING`,
    [CHIP_ID, JSON.stringify({ datachip: true, clip_id: REEL_ID })]
  );
  await reloadItem(CHIP_ID);
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition)
     VALUES ('11111111-1111-1111-1111-111111111111',$1,$2,1,1.0)`,
    [sp.id, CHIP_ID]
  );
  r = await run('tabletnav specter chips');
  check('microreels list surfaces the carried reel', r?.view === 'list' && r.items.some(it => it.id === REEL_ID), JSON.stringify(r?.items)?.slice(0, 200));
  r = await run(`tabletnav specter microreels ${REEL_ID}`);
  check('opening a reel routes to the inline reel viewer', r?.view === 'reel' && Array.isArray(r?.reel?.frames) && r.reel.frames.length === 2, JSON.stringify(r)?.slice(0, 200));
  check('reel frames carry kind for speech/emote colouring', r?.reel?.frames?.[0]?.kind === 'say' && r?.reel?.frames?.[1]?.kind === 'event', JSON.stringify(r?.reel?.frames)?.slice(0, 160));
  await query('DELETE FROM security_clips WHERE id=$1', [REEL_ID]);
  await query('DELETE FROM player_inventory WHERE item_id=$1', [CHIP_ID]);
  await query('DELETE FROM items WHERE id=$1', [CHIP_ID]);
  deleteItemCache(CHIP_ID);

  // The Clear action delegates to the `wipe` verb and re-renders the hub — even
  // with no deployed cam it returns a surveillance view without throwing.
  r = await run('tabletaction specter clear');
  check('specter clear action returns a surveillance view', r?.type === 'tablet_panel' && r?.appId === 'specter' && r?.view === 'surveillance' && !r?.error, JSON.stringify(r)?.slice(0, 200));

  // Turn-in is an IN-PERSON hand-in: standing in the giver's zone brings up their
  // dialogue and closes the tablet (root node fires TURN_IN on render + pays out,
  // action returns { type: 'tablet_close' }); away from the giver it refuses and
  // routes there instead of completing remotely. Put the NPC in its own zone to
  // prove both halves.
  const TQ = 'quest_regress_tabletturnin';
  const TN = 'npc_regress_tabletturnin';
  const player = getPlayer();
  const savedZone = player.current_zone;
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Tablet Turn-In','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    [TQ, JSON.stringify([{ type: 'visit', zone: 'zone_regress_tabletturnin_elsewhere', count: 1, desc: 'Go elsewhere' }])]
  );
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,dialogue_tree,home_zone)
     VALUES ($1,'Regress Tablet Turn-In NPC','','zone_regress_tabletturnin_faraway',$2,'zone_regress_tabletturnin_faraway')
     ON CONFLICT (id) DO UPDATE SET dialogue_tree=$2, zone_id=$3, home_zone=$3`,
    [TN, JSON.stringify({ root: { text: 'Hi.', actions: [{ action: 'TURN_IN', quest_id: TQ }], options: [] } }), 'zone_regress_tabletturnin_faraway']
  );
  // The turn-in path reads NPCs from world.npcs (write funnel) — mirror the seed.
  world.npcs.set(TN, {
    id: TN, name: 'Regress Tablet Turn-In NPC', description: '',
    zone_id: 'zone_regress_tabletturnin_faraway', home_zone: 'zone_regress_tabletturnin_faraway',
    dialogue_tree: { root: { text: 'Hi.', actions: [{ action: 'TURN_IN', quest_id: TQ }], options: [] } },
    vendor_inventory: [], wander_zones: [], behaviour_graph: {}, flags: {}, banter: [], _ai: {},
  });
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query(
    "INSERT INTO player_quests (player_id,quest_id,status,progress) VALUES ($1,$2,'completed','[1]')",
    [player.id, TQ]
  );

  // Away from the giver: the hand-in is refused (routed, not completed) — the
  // tablet stays on the quest detail and the quest is still 'completed', not
  // 'turned_in'.
  player.current_zone = savedZone;
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in away from the giver refuses (stays on the tablet, no hand-in)', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r)?.slice(0, 200));
  const { rows: notYet } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  check('turn-in away from the giver does NOT complete the quest', notYet[0]?.status === 'completed', JSON.stringify(notYet));

  // In the giver's zone: the dialogue opens, the tablet closes, and the quest pays
  // out / turns in.
  player.current_zone = 'zone_regress_tabletturnin_faraway';
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in in the giver zone brings up the dialogue and closes the tablet', r?.type === 'tablet_close', JSON.stringify(r)?.slice(0, 200));
  const { rows: turned } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  check('turn-in via dialogue pays out / completes the quest', turned[0]?.status === 'turned_in', JSON.stringify(turned));

  // Anti-stuck guarantee: a completed quest with NO NPC tied to it (the giver was
  // deleted, or it's a self-landing flight contract) must still turn in — it falls
  // through to the direct grant rather than dead-ending. Remove the NPC and retry.
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  world.npcs.delete(TN);
  await query("UPDATE player_quests SET status='completed' WHERE player_id=$1 AND quest_id=$2", [player.id, TQ]);
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in with no NPC falls through to the direct grant (never stuck)', r?.type === 'tablet_panel' && r?.view !== 'error', JSON.stringify(r)?.slice(0, 200));

  player.current_zone = savedZone;
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  world.npcs.delete(TN);
  await query('DELETE FROM quests WHERE id=$1', [TQ]);

  // Word on the Street (news-generator getStories) must never surface a duplicate
  // headline — the live ring dedupes on record, and the assembled feed dedupes
  // live vs. tabloid filler.
  news.record('Regress News Dupe Headline'); // same headline recorded twice…
  news.record('Regress News Dupe Headline');
  const ringCopies = news.RING.filter(s => s.headline === 'Regress News Dupe Headline').length;
  check('recording the same headline twice keeps one ring copy', ringCopies === 1, `copies=${ringCopies}`);
  const stories = await news.getStories(12);
  const heads = stories.map(s => String(s.headline).trim().toLowerCase());
  check('getStories returns no duplicate headlines', heads.length === new Set(heads).size, JSON.stringify(heads));
}
