// Tablet OS plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player's id matches no players row, so DB writes are
// no-ops; this asserts routing + payload shape, not real data.
import { query } from '../../server/models/db.js';
import { setFlag } from '../../server/engine/flags.js';

export default async function regress({ run, check, getPlayer }) {
  let r = await run('tablet');
  check('tablet verb opens home screen', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));
  check('home screen carries player summary', !!r?.player && typeof r.player.credits === 'number', JSON.stringify(r?.player));
  check('home screen lists apps', Array.isArray(r?.apps) && r.apps.length >= 9, `apps=${r?.apps?.length}`);
  check('home screen apps include quests/skills/bank/weather/vehicles/properties/settings/corp/specter',
    ['quests', 'skills', 'bank', 'weather', 'vehicles', 'properties', 'settings', 'corp', 'specter']
      .every(id => r.apps.some(a => a.id === id)),
    JSON.stringify(r?.apps?.map(a => a.id)));

  r = await run('os');
  check('os verb aliases tablet', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));

  // Nav into each simple app's root screen — asserts buildScreen doesn't throw
  // and returns a recognizable view.
  for (const appId of ['skills', 'bank', 'weather', 'vehicles', 'properties', 'settings', 'corp']) {
    r = await run(`tabletnav ${appId}`);
    check(`tabletnav ${appId} routes to app`, r?.type === 'tablet_panel' && r?.screen === 'app' && r?.appId === appId, JSON.stringify(r));
    check(`tabletnav ${appId} has no error`, !r?.error, r?.error);
  }

  // Quests app: category root (no rows for the fake player, but must not error).
  r = await run('tabletnav quests');
  check('tabletnav quests routes', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r));
  check('quests root is category view', r?.view === 'categories', JSON.stringify(r));

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

  // Turn-in, wrong zone: stays on the quest's own detail screen (objectives/
  // actions intact) instead of swapping to a bare error screen — the "head to
  // X" nudge goes out as a bottom-pane message instead.
  const TQ = 'quest_regress_tabletturnin';
  const TN = 'npc_regress_tabletturnin';
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Tablet Turn-In','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    [TQ, JSON.stringify([{ type: 'visit', zone: 'zone_regress_tabletturnin_elsewhere', count: 1, desc: 'Go elsewhere' }])]
  );
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,dialogue_tree,home_zone)
     VALUES ($1,'Regress Tablet Turn-In NPC','','zone_regress_tabletturnin_npc',$2,'zone_regress_tabletturnin_npc')
     ON CONFLICT (id) DO UPDATE SET dialogue_tree=$2, zone_id=$3`,
    [TN, JSON.stringify({ root: { text: 'Hi.', actions: [{ action: 'TURN_IN', quest_id: TQ }], options: [] } }), 'zone_regress_tabletturnin_npc']
  );
  const player = getPlayer();
  const savedZone = player.current_zone;
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query(
    "INSERT INTO player_quests (player_id,quest_id,status,progress) VALUES ($1,$2,'completed','[1]')",
    [player.id, TQ]
  );
  player.current_zone = 'zone_regress_tabletturnin_somewhere_else';

  r = await run(`tabletaction quests turnin ${TQ}`);
  check('failed turn-in stays on the quest detail screen', r?.view === 'detail' && (r?.quest?.id === TQ || r?.detail?.id === TQ), JSON.stringify(r)?.slice(0, 200));

  player.current_zone = savedZone;
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TQ]);
  await query('DELETE FROM npcs WHERE id=$1', [TN]);
  await query('DELETE FROM quests WHERE id=$1', [TQ]);
}
