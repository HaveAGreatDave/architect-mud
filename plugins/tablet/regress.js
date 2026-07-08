// Tablet OS plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player's id matches no players row, so DB writes are
// no-ops; this asserts routing + payload shape, not real data.
export default async function regress({ run, check }) {
  let r = await run('tablet');
  check('tablet verb opens home screen', r?.type === 'tablet_panel' && r?.screen === 'home', JSON.stringify(r));
  check('home screen carries player summary', !!r?.player && typeof r.player.credits === 'number', JSON.stringify(r?.player));
  check('home screen lists apps', Array.isArray(r?.apps) && r.apps.length >= 8, `apps=${r?.apps?.length}`);
  check('home screen apps include quests/skills/bank/weather/vehicles/properties/settings/corp',
    ['quests', 'skills', 'bank', 'weather', 'vehicles', 'properties', 'settings', 'corp']
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
  // exercises the "not in a corp" path — same message buildConsolePayload
  // itself returns for `corp console` with no membership.
  r = await run('tabletnav corp');
  check('corp app (no membership) reports not-in-a-corp cleanly', r?.view === 'error' && /not in a corp/i.test(r?.message || ''), JSON.stringify(r));
}
