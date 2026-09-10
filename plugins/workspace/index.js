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
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

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
  // An `idle` area row is a piece of the room standing empty — a free burner, a
  // clear bench. It must not count towards "there is something here", or a
  // kitchen with a cold stove and nothing else stops reading as bare.
  view.empty = !view.storage.length && !view.area.some(v => !v.idle) && !view.components.length;

  // Same decoration seam the container panel uses (`container.view`): a plugin
  // that wants to hang its own block off a workspace mutates the view in place.
  await fireHook('workspace.view', { view, provider, player });
  return view;
}

// ── The written workspace ────────────────────────────────────────────────────
// The bottom Display Mode rung gets the same view as prose rather than a panel.
//
// This one CANNOT be a suppression the way the card reveal is. The HUD aggregates
// state that is nowhere else in the log: what is stored in reach, what is out on
// the surface, what is mid-cook and how far along, which tools are here, whether
// the stove is free. `look` shows you a room, not a working area. So the rung
// needs a real rendering, and suppressing the panel without one would delete
// information rather than re-present it (see logRender's contract).
//
// It renders the SAME payload the panel does — one builder, two presentations —
// so the two can never disagree about what is on the bench. And every action it
// prints is the same verb string the panel's buttons carry, which is this
// plugin's founding rule: the HUD holds no gameplay logic.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const link = (cmd, label) =>
  `<span class="action-link" data-action="cmd" data-cmd="${esc(cmd)}">${esc(label || cmd)}</span>`;

function renderRow(c) {
  const bits = [];
  if (c.qty) bits.push(`×${c.qty}`);
  // An area row says WHERE it is (`on the stove`, `in hand`, `free`) where a
  // component says what state it's in. Both belong in the same parenthesis, and
  // printing neither left a free burner reading as a bare noun.
  if (c.state || c.place) bits.push(c.state || c.place);
  if (c.notes?.length) bits.push(...c.notes);
  // A cook in progress is the one thing here that is MOVING — the panel dims
  // everything else to say so, and the log has to say it in words instead.
  const live = c.live ? '<span class="text-cyan">▸</span> ' : '  ';
  const tail = bits.length ? ` <span class="text-dim">(${esc(bits.join(' · '))})</span>` : '';
  // Actions are `{ label, command, hint }` — verb strings a player could have
  // typed, which is this plugin's founding rule. Printed as the clickable links
  // they already are, so the log version is operable by mouse or by typing.
  const acts = (c.actions || []).length
    ? `\n      <span class="text-dim">${c.actions.map(a => link(a.command, a.label)).join(' · ')}</span>`
    : '';
  return `${live}<b>${esc(c.name)}</b>${tail}${acts}`;
}

function renderWorkspaceText(view) {
  const out = [`<span class="text-cyan">${esc(view.title || 'WORKSPACE')}</span>`];

  if (view.status?.length) {
    out.push(view.status.map(s => {
      const cls = s.state === 'off' ? 'text-red' : s.state === 'warn' ? 'text-amber' : 'text-dim';
      return `  <span class="text-dim">${esc(s.label)}:</span> <span class="${cls}">${esc(s.value)}</span>`;
    }).join('\n'));
  }

  const section = (label, rows) => {
    if (!rows?.length) return null;
    return `<span class="furniture-label">${label}:</span>\n${rows.map(renderRow).join('\n')}`;
  };
  for (const block of [
    section('On the surface', view.area),
    section('Within reach', view.storage),
    section('Components', view.components),
    section('Tools', view.tools),
  ]) if (block) out.push(block);

  if (view.empty) out.push('<span class="text-dim">The workspace is bare. Nothing out, nothing stored, nothing on the heat.</span>');

  // The Assistant, printed group by group in the provider's own order. It scores
  // only recipes you KNOW — listing the undiscovered half with exact shortfalls is
  // the ingredient checklist the Cookbook deliberately refuses to be, and it would
  // kill discovery. That rule is the provider's; this prints what it was handed and
  // adds nothing, including the closing note about how many are still out there.
  const a = view.assistant;
  for (const g of a?.groups || []) {
    if (!g.recipes?.length) continue;
    out.push(`<span class="furniture-label">${esc(g.label)}:</span>\n`
      + g.recipes.slice(0, 8).map(r => {
        // The shortfall as NOUNS on the headline and as its own indented lines
        // under it — the same split the panel makes, because a log rung that
        // printed the whole ingredient sentence inline was the run-on line this
        // was reworked out of. If a provider hands over no rows (an older one,
        // or a domain with nothing to say about shops), the prose falls back.
        const rows = r.shortfall || [];
        const short = rows.length ? ` <span class="text-dim">— short: ${esc(rows.map(s => s.noun).join(', '))}</span>`
          : r.missing?.length ? ` <span class="text-dim">— short: ${esc(r.missing.join(', '))}</span>` : '';
        const gear = r.equipment?.length ? ` <span class="text-dim">— needs ${esc(r.equipment.join(', '))}</span>` : '';
        const pct = Number.isFinite(r.pct) ? ` <span class="text-dim">${Math.round(r.pct)}%</span>` : '';
        const acts = (r.actions || []).map(x => link(x.command, x.label || 'prepare')).join(' · ');
        // Where to get each one. Only on a recipe you could realistically go and
        // finish — a list of eight recipes each printing three stockists is a
        // wall, so the lines belong to the ones nearest to ready.
        const detail = (rows.length && rows.length <= 3)
          ? '\n' + rows.map(s => {
            const where = s.shops?.length ? ` <span class="text-dim">· ${esc(s.shops.join(', '))}</span>`
              : s.sold === false ? ` <span class="text-dim">· no shop sells it</span>` : '';
            return `      ${esc(s.noun)}${s.amount ? ` <span class="text-dim">${esc(s.amount)}</span>` : ''}${where}`;
          }).join('\n')
          : '';
        // THE RUNBOOK REACHES THE LOG. A player at the bottom display rung is
        // reading this instead of the panel, so a recipe they could actually
        // make right now prints its whole command list — every step a link,
        // which is the same dispatch the panel's buttons use. Only the ones
        // that are ready carry one, which is what keeps this from becoming a
        // wall: eight short recipes print eight headlines and no steps.
        const walk = (r.walkthrough || []).length
          ? '\n' + r.walkthrough.map((s, i) =>
            `      <span class="text-dim">${i + 1}.</span> ${esc(s.text)}`
            + (s.command ? `  ${link(s.command, s.command)}` : '')).join('\n')
          : '';
        return `  <b>${esc(r.name)}</b>${pct}${short}${gear}${acts ? `  ${acts}` : ''}${detail}${walk}`;
      }).join('\n'));
  }
  if (a?.note) out.push(`<span class="text-dim">${esc(a.note)}</span>`);

  if (view.providers?.length > 1) {
    out.push(`<span class="text-dim">Also here: ${view.providers.map(p => link(`workspace ${p.key}`, p.label)).join(' · ')}</span>`);
  }
  return out.join('\n');
}

/**
 * The same view as a generic list-dialog payload (client/game/js/panels/listdialog.js).
 *
 * Reads the view the provider already built — no second question, so the dialog
 * and the written HUD cannot disagree. Every row's `commands` are the provider's
 * own `{ label, command }` action objects, passed through verbatim: this plugin's
 * rule is that the HUD proposes and the VERB decides, and re-deriving anything
 * here would be the duplicate implementation the whole layer exists to avoid.
 */
function workspaceDialogPayload(view) {
  const rows = [];
  const push = (group, list) => {
    for (const c of list || []) {
      const bits = [];
      if (c.state || c.place) bits.push(c.state || c.place);
      if (c.notes?.length) bits.push(...c.notes);
      rows.push({
        group,
        label: `${c.live ? '▸ ' : ''}${c.name}`,
        detail: bits.join(' · '),
        commands: (c.actions || []).map(a => ({ label: a.label, command: a.command })),
      });
    }
  };
  push('On the surface', view.area);
  push('Within reach', view.storage);
  push('Components', view.components);
  push('Tools', view.tools);

  for (const g of view.assistant?.groups || []) {
    for (const r of (g.recipes || []).slice(0, 8)) {
      const short = (r.shortfall || []).length ? r.shortfall.map(s => s.noun).join(', ')
        : (r.missing || []).join(', ');
      rows.push({
        group: g.label,
        label: r.name,
        detail: [Number.isFinite(r.pct) ? `${Math.round(r.pct)}%` : null,
          short ? `short: ${short}` : null,
          r.equipment?.length ? `needs ${r.equipment.join(', ')}` : null].filter(Boolean).join(' · '),
        commands: (r.actions || []).map(x => ({ label: x.label || 'prepare', command: x.command })),
      });
    }
  }

  const foot = [view.assistant?.note,
    view.providers?.length > 1 ? `Also here: ${view.providers.map(p => p.label).join(', ')}` : null,
    'workspace text to read it in the log'].filter(Boolean).join(' · ');
  return {
    type: 'list_dialog',
    title: view.title || 'Workspace',
    subtitle: (view.status || []).map(s => `${s.label}: ${s.value}`).join(' · '),
    rows: rows.length ? rows : [{ label: 'The workspace is bare. Nothing out, nothing stored, nothing on the heat.' }],
    footer: foot,
  };
}

// Exported because a domain verb can BE the way into its own workspace — a bare
// `cook` at a stove opens the kitchen HUD rather than answering "Cook what?".
export async function cmdWorkspace(args, raw, player) {
  // `text` is a MODIFIER, not a provider key, so it is lifted out rather than
  // read positionally. That is what lets a caller name its own provider AND ask
  // for prose in one go (`cook text` arrives as `['kitchen', 'text']`) — reading
  // `args[0]` alone meant a kitchen with a chem lab in the back printed whichever
  // provider happened to win on priority.
  const argv = (args || []).map(a => String(a || '').toLowerCase()).filter(Boolean);
  const forceText = argv.includes('text');
  const view = await buildWorkspaceView(player, argv.find(a => a !== 'text') || null);
  if (!view) {
    return {
      type: 'error',
      message: `There's nothing here to work at. A workspace needs equipment — a stove, a bench, something with a surface.`,
    };
  }
  // `workspace text` (or `cook text` at a stove) forces the written HUD at any
  // rung — same escape hatch as `shop text` and `tablet verbs`.
  if (forceText) return { type: 'output', message: renderWorkspaceText(view) };
  if (await prefersLoggedPanelsOrDefault(player)) {
    // ⚠ The dialog is the CONTROL; the log still gets the RECORD — the same rule
    // `shop` follows (plugins/commerce/index.js), and the log rung's own contract
    // is that a system's record reaches `#output`. One line, not the whole HUD:
    // the dialog is what you act through, `workspace text` is what you read, and
    // a player scrolling back has to be able to see they opened the bench at all.
    sendToPlayer(player.id, {
      type: 'output',
      message: `<span class="msg-system">${esc(view.title || 'The workspace')} is open. `
        + `<span class="action-link" data-action="cmd" data-cmd="workspace text">workspace text</span> to read it here instead.</span>`,
    });
    // The HUD is the single best fit for the generic dialog in the whole game: this
    // plugin's founding rule is that every action it offers is a verb string a
    // player could have typed, so the rows convert to `commands: []` with nothing
    // invented and nothing lost. It is also reprinted between crafting steps, which
    // is what made 30–70 lines a real cost rather than a one-off.
    return workspaceDialogPayload(view);
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
    lines.push(`<span class="text-dim">Ready${plan.vessel ? ` — it's all in the ${plan.vessel}` : ''}. Cooking it's yours.</span>`);
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

// The text rendering is pure over a payload, so regress can assert it without a
// kitchen, a stove or a player.
export const _test = { renderWorkspaceText, renderRow };
