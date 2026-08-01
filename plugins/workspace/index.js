// PREPARATION WORKSPACE — a text HUD over a working area.
//
// This plugin is domain-agnostic. It knows how to ask the room "is anybody a
// workspace here", assemble whatever that provider hands back into one payload,
// and ship it to the client. It knows nothing about food, heat, chemistry or
// guns, and it must not learn: the moment this file contains a profile name or
// a verb, the second workspace (a chem bench, a gunsmith's) stops being free.
//
// THE RULE, and the reason this is a plugin rather than engine code:
//
//   The HUD holds no gameplay logic. Every action it will ever offer resolves
//   to a verb string a player could have typed, dispatched through the ordinary
//   command pipeline.
//
// Phase 1 is READ-ONLY — it renders the area and offers nothing to click. That
// is deliberate: it proves the payload and the seam before anything can mutate
// through them. See docs/proposals/preparation-workspace.md for the build order.
//
// Providers register through the `workspace.provider` gather-hook, so a domain
// plugin contributes one without either side importing the other. A provider is:
//
//   { key, label, priority, build(player) -> { storage, area, components, … } }
//
// `priority` settles a room that is two workspaces at once; the highest wins,
// and a tie is the alphabetical key so the answer is at least stable.
import { gatherHook, fireHook } from '../../server/engine/plugins.js';

// Providers are gathered fresh per invocation rather than cached. The hook is a
// pure in-memory room check by contract (kitchen's is `getZoneFurniture` and a
// filter), so gathering costs nothing, and caching it would go stale the moment
// somebody installed a stove.
async function providersFor(player) {
  const found = await gatherHook('workspace.provider', player);
  return found
    .filter(p => p && typeof p.build === 'function')
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || String(a.key).localeCompare(String(b.key)));
}

export async function buildWorkspaceView(player, providerKey = null) {
  const providers = await providersFor(player);
  if (!providers.length) return null;

  const provider = providerKey
    ? providers.find(p => p.key === providerKey) || providers[0]
    : providers[0];

  const built = await provider.build(player);
  if (!built) return null;

  const view = {
    type: 'workspace_view',
    provider: provider.key,
    title: provider.label || 'WORKSPACE',
    // What else the room could have been. Phase 1 shows it as a readout; it is
    // the seam a provider switcher hangs off later without a payload change.
    providers: providers.map(p => ({ key: p.key, label: p.label || p.key })),
    storage: built.storage || [],
    area: built.area || [],
    components: built.components || [],
    tools: built.tools || [],
    status: built.status || [],
    assistant: built.assistant || null,
  };
  view.empty = !view.storage.length && !view.area.length && !view.components.length;

  // Same decoration seam the container panel uses (`container.view`): a plugin
  // that wants to hang its own block off a workspace mutates the view in place.
  await fireHook('workspace.view', { view, provider, player });
  return view;
}

async function cmdWorkspace(args, raw, player) {
  const view = await buildWorkspaceView(player, args?.[0]?.toLowerCase() || null);
  if (!view) {
    return {
      type: 'error',
      message: `There's nothing here to work at. A workspace needs equipment — a stove, a bench, something with a surface.`,
    };
  }
  if (view.empty) {
    view.mainMsg = `<span class="text-dim">The workspace is bare. Nothing out, nothing stored, nothing on the heat.</span>`;
  }
  return view;
}

// ── Prepare: run a plan, re-validating every step ────────────────────────────
//
// A plan is an ordered list of ORDINARY COMMANDS, and the runner types them one
// at a time. That is the whole design, and it is what makes reservation
// unnecessary: nothing is claimed up front, so nothing can be stranded. If the
// world moved between the plan and the run, the step that depended on it fails
// with the message that verb already produces, and the run stops there.
//
// Two hard rules, both enforced below:
//
//   • STOP ON THE FIRST FAILURE. Ploughing on would leave half a recipe in a pan
//     and a player who has to work out which half.
//   • NEVER ANSWER A PROMPT. If a step raises a SIFT disambiguation, the run
//     hands it to the player and stops — a runner that picked for you would be
//     making choices the game deliberately asks a human to make.
const MAX_STEPS = 24;

async function runPlan(plan, player, broadcast) {
  const { handleCommand } = await import('../../server/engine/commands/index.js');
  const { getSelectionState } = await import('../../server/engine/sift.js');

  const done = [];
  let stopped = null;

  for (const step of plan.steps.slice(0, MAX_STEPS)) {
    const res = await handleCommand(step, player, broadcast);
    if (res?.type === 'error' || res?.type === 'container_error') {
      stopped = { step, why: res.message };
      break;
    }
    done.push(step);
    // A step that opened a disambiguation owns the player's next input. Stop and
    // let them answer it; resuming afterwards is their call.
    if (getSelectionState(player.id)) {
      stopped = { step, why: `That needs you to pick which one — the rest is yours to finish.` };
      break;
    }
  }

  const lines = [`<span class="text-bright">${plan.label}</span>`];
  for (const s of done) lines.push(`  <span class="text-dim">✓ ${s}</span>`);
  if (stopped) {
    lines.push(`  <span class="text-bright">✗ ${stopped.step}</span> <span class="text-dim">— ${stopped.why}</span>`);
    lines.push(`<span class="text-dim">Stopped after ${done.length} of ${plan.steps.length}.</span>`);
  } else {
    lines.push(`<span class="text-dim">Ready${plan.vessel ? ` — it's all in the ${plan.vessel}` : ''}. Cooking it is yours.</span>`);
  }
  return { type: 'output', message: lines.join('\n') };
}

async function cmdPrepare(args, raw, player, broadcast) {
  const providers = await providersFor(player);
  const provider = providers.find(p => typeof p.plan === 'function');
  if (!provider) return { type: 'error', message: `There's nothing here that prepares anything.` };

  const plan = await provider.plan(player, args.join(' '));
  if (!plan || plan.error) return { type: 'error', message: plan?.error || `Nothing to prepare.` };
  if (!plan.steps?.length) return { type: 'error', message: `Nothing to do — it's already laid out.` };

  return runPlan(plan, player, broadcast);
}

export const commands = {
  workspace: cmdWorkspace,
  prepare: cmdPrepare,
  // Nobody types "workspace" at a stove. `bench` is what the thing is called
  // everywhere except this file.
  bench: cmdWorkspace,
};
