// Tablet OS plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player's id matches no players row, so DB writes are
// no-ops; this asserts routing + payload shape, not real data.
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';
import { _test as news } from './news-generator.js';

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

  // Map app: the tablet-native city map. Reuses buildMapPayload, so the root
  // resolves to a map view with a tiles array + mode; a mode arg switches level.
  r = await run('tabletnav map');
  check('map app routes to a map view', r?.type === 'tablet_panel' && r?.appId === 'map' && r?.view === 'map', JSON.stringify(r)?.slice(0, 200));
  check('map app carries tiles + mode with no error', Array.isArray(r?.tiles) && typeof r?.mode === 'string' && !r?.error, JSON.stringify(r)?.slice(0, 200));
  r = await run('tabletnav map regional');
  check('map app regional mode switches level', r?.view === 'map' && r?.mode === 'regional', JSON.stringify(r)?.slice(0, 200));

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

  // The Clear action delegates to the `wipe` verb and re-renders the hub — even
  // with no deployed cam it returns a surveillance view without throwing.
  r = await run('tabletaction specter clear');
  check('specter clear action returns a surveillance view', r?.type === 'tablet_panel' && r?.appId === 'specter' && r?.view === 'surveillance' && !r?.error, JSON.stringify(r)?.slice(0, 200));

  // Turn-in ALWAYS brings up the quest-giver's dialogue and closes the tablet,
  // regardless of where the player is standing — it's a comms hand-in, not a
  // physical one. The NPC's root node fires TURN_IN on render (pays out), and the
  // action returns { type: 'tablet_close' }. Put the NPC in a zone far from the
  // player to prove location no longer gates it.
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
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query(
    "INSERT INTO player_quests (player_id,quest_id,status,progress) VALUES ($1,$2,'completed','[1]')",
    [player.id, TQ]
  );

  player.current_zone = savedZone;
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in brings up the giver dialogue and closes the tablet (any zone)', r?.type === 'tablet_close', JSON.stringify(r)?.slice(0, 200));
  const { rows: turned } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  check('turn-in via dialogue pays out / completes the quest', turned[0]?.status === 'turned_in', JSON.stringify(turned));

  // Anti-stuck guarantee: a completed quest with NO NPC tied to it (the giver was
  // deleted, or it's a self-landing flight contract) must still turn in — it falls
  // through to the direct grant rather than dead-ending. Remove the NPC and retry.
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  await query("UPDATE player_quests SET status='completed' WHERE player_id=$1 AND quest_id=$2", [player.id, TQ]);
  r = await run(`tabletaction quests turnin ${TQ}`);
  check('turn-in with no NPC falls through to the direct grant (never stuck)', r?.type === 'tablet_panel' && r?.view !== 'error', JSON.stringify(r)?.slice(0, 200));

  player.current_zone = savedZone;
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
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
