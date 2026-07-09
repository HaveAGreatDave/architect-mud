// Tablet OS — Corporation app. Was a deferred pass-through to the standalone
// corp-console.js overlay for Phase 1; now rendered natively in the Tablet
// shell. Reuses plugins/corps/index.js's buildConsolePayload() (the exact data
// the `corp console` command itself returns) and its `corp` command dispatcher
// for actions (found/contribute/invest/colour/fold) — no corp logic duplicated
// here, this is a reshape into the Tablet's `view: 'corp'` dashboard + buttons.
import { getOrg, getPlayerMembership } from '../../server/engine/world.js';
import { PERM, hasPerm } from '../../server/engine/org-perms.js';
import { registerTabletApp, normScreen } from './registry.js';

async function buildHome(player) {
  const m = getPlayerMembership(player.id);
  return { hasCorp: !!m, corpName: m ? getOrg(m.org_id)?.name || null : null };
}

// Territory Map sub-screen — the same tiles/control payload the `corp map`
// overlay uses (cmdCorpMap), reshaped into a Tablet view. Works with or without
// a corp (an unaffiliated player still sees rival turf), so it sits ahead of the
// no-corp founding gate. `type` is stripped so it doesn't clobber the tablet_panel
// envelope's own type in the index.js wrapper.
async function buildMapScreen(player) {
  const { cmdCorpMap } = await import('../corps/index.js');
  const { type, ...map } = await cmdCorpMap(player);
  return { view: 'corp_map', breadcrumb: ['Corporation', 'Territory Map'], ...map };
}

async function buildScreen(player, screenId) {
  const { buildConsolePayload, FOUND_FEE, corpColorOptions } = await import('../corps/index.js');
  const m = getPlayerMembership(player.id);

  if (normScreen(screenId) === 'map') return buildMapScreen(player);

  // No corp yet → the founding screen (cost warning + name prompt). Colour is
  // chosen afterwards on the dashboard, once the corp exists to attach it to.
  if (!m) {
    return { view: 'corp_found', foundFee: FOUND_FEE, credits: player.credits || 0 };
  }

  const payload = await buildConsolePayload(player);
  if (payload?.type === 'error') return { view: 'error', message: payload.message };

  const org = getOrg(m.org_id);
  const canEdit = hasPerm(player, PERM.EDIT_CORP);
  const canFold = org.owner_id === player.id || hasPerm(player, PERM.DISBAND);

  const actions = [{ id: 'contribute', label: 'Contribute', prompt: 'Contribution amount (credits):' }];
  if (payload.tierInfo?.nextCost != null) {
    actions.push({ id: 'invest', label: `Invest ₵${payload.tierInfo.nextCost.toLocaleString()}` });
  }
  if (canFold) {
    actions.push({ id: 'fold', label: 'Fold Corp', confirm: `Fold ${org.name}? This deletes the corp for good — the treasury is refunded to the owner and any HQ is released.` });
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
      color: org.color || null,
      canEdit,
    },
    palette: canEdit ? await corpColorOptions(m.org_id) : null,
    actions,
  };
}

async function handleAction(player, actionId, params, broadcast) {
  const { commands: corpCommands } = await import('../corps/index.js');
  const run = (args, raw) => corpCommands.corp(args, raw, player, broadcast);

  if (actionId === 'found') {
    const name = (params || '').trim();
    if (!name) return { view: 'error', message: 'Enter a name for your corp.' };
    const res = await run(['found'], `corp found ${name}`);
    if (res?.type === 'error') return { ...(await buildScreen(player)), notice: res.message };
    return buildScreen(player);
  }

  if (actionId === 'set_color') {
    const hex = (params || '').trim().toLowerCase();
    const res = await run(['edit', 'color', hex], `corp edit color ${hex}`);
    // Stay on the picker with the reason (e.g. "too close to X's") on failure.
    if (res?.type === 'error') return { ...(await buildScreen(player)), notice: res.message };
    return buildScreen(player);
  }

  if (actionId === 'fold') {
    const res = await run(['disband'], 'corp disband');
    if (res?.type === 'error') return { ...(await buildScreen(player)), notice: res.message };
    return buildScreen(player); // now the no-corp founding screen
  }

  if (actionId === 'contribute') {
    const amt = parseInt(params, 10);
    if (!amt || amt <= 0) return { view: 'error', message: 'Enter a valid contribution amount.' };
    const res = await run(['contribute', String(amt)], `corp contribute ${amt}`);
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player);
  }

  if (actionId === 'invest') {
    const res = await run(['invest'], 'corp invest');
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player);
  }

  // Territory Map actions — the same verbs the standalone map fires, but they only
  // work where you stand (the corp commands enforce that). `build:extractor` splits
  // into `corp build extractor`. On any outcome we rebuild the map screen so the
  // control layer refreshes; an error rides back as a notice on the map.
  if (actionId === 'mapact') {
    const spec = (params || '').trim().toLowerCase();
    const [verb, arg] = spec.startsWith('build:') ? ['build', spec.slice(6)] : [spec, null];
    const args = arg ? [verb, arg] : [verb];
    const res = await run(args, `corp ${args.join(' ')}`);
    const mapScreen = await buildMapScreen(player);
    return res?.type === 'error' ? { ...mapScreen, notice: res.message } : mapScreen;
  }

  return buildScreen(player);
}

registerTabletApp({
  id: 'corp', name: 'Corporation', icon: '🏢', category: 'Social',
  buildHome, buildScreen, handleAction,
});
