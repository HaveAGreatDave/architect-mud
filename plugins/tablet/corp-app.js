// Tablet OS — Corporation app. Was a deferred pass-through to the standalone
// corp-console.js overlay for Phase 1; now rendered natively in the Tablet
// shell. Reuses plugins/corps/index.js's buildConsolePayload() (the exact data
// the `corp console` command itself returns) and its `corp` command dispatcher
// for actions (contribute/invest) — no corp logic duplicated here, this is a
// reshape into the Tablet's `view: 'corp'` dashboard + generic action buttons.
import { getOrg, getPlayerMembership } from '../../server/engine/world.js';
import { registerTabletApp } from './registry.js';

async function buildHome(player) {
  const m = getPlayerMembership(player.id);
  return { hasCorp: !!m, corpName: m ? getOrg(m.org_id)?.name || null : null };
}

async function buildScreen(player) {
  const { buildConsolePayload } = await import('../corps/index.js');
  const payload = await buildConsolePayload(player);
  if (payload?.type === 'error') return { view: 'error', message: payload.message };

  const actions = [{ id: 'contribute', label: 'Contribute', prompt: 'Contribution amount (credits):' }];
  if (payload.tierInfo?.nextCost != null) {
    actions.push({ id: 'invest', label: `Invest ₵${payload.tierInfo.nextCost.toLocaleString()}` });
  }

  return {
    view: 'corp',
    breadcrumb: [],
    corp: {
      name: payload.org?.name, tag: payload.org?.tag, tier: payload.org?.tier,
      rank: payload.you?.rank,
      treasury: payload.treasury,
      tierInfo: payload.tierInfo,
      members: payload.members || [],
      territory: payload.territory || [],
      relations: payload.relations || [],
    },
    actions,
  };
}

async function handleAction(player, actionId, params, broadcast) {
  const { commands: corpCommands } = await import('../corps/index.js');

  if (actionId === 'contribute') {
    const amt = parseInt(params, 10);
    if (!amt || amt <= 0) return { view: 'error', message: 'Enter a valid contribution amount.' };
    const res = await corpCommands.corp(['contribute', String(amt)], `corp contribute ${amt}`, player, broadcast);
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player);
  }

  if (actionId === 'invest') {
    const res = await corpCommands.corp(['invest'], 'corp invest', player, broadcast);
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player);
  }

  return buildScreen(player);
}

registerTabletApp({
  id: 'corp', name: 'Corporation', icon: '🏢', category: 'Social',
  buildHome, buildScreen, handleAction,
});
