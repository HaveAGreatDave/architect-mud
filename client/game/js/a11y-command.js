// The `accessibility` verb.
//
// Every option here also lives on the Tablet's Accessibility page, and BOTH read
// A11Y_OPTIONS in client/shared/settings.js — neither owns the list. Add an
// option there and it appears in both, spelled the same way, explained the same
// way. That is the point of the table: two surfaces, one truth.
//
// This exists because of a circularity that is easy to build and embarrassing to
// ship: the settings that make the interface usable were reachable only THROUGH
// that interface. A player who cannot read 11px text has to find and operate a
// simulated tablet — tiles, pages, pill rows — to reach the control that makes
// text bigger. `displaymode` already had a plain verb for exactly this reason;
// this is the rest of it.
//
// Output is HTML into #output, so it lands in the log and is announced like any
// other line. No panel, no overlay, no focus to manage.
// Relative, not the '/shared/…' form the browser also accepts, so this module can
// be imported and exercised in Node — see scripts/a11y/verb-smoke.mjs.
import { loadSettings, saveSettings, applySettings, A11Y_OPTIONS, effectiveOptionValue } from '../../shared/settings.js';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function commit(settings) {
  saveSettings(settings);
  applySettings(settings);
}

// `text large` should work as readily as `text 19`. Match on the option's own
// label first, then its stored value, then a unique prefix of the label — so
// `text x` finds X-Large and `font read` finds Readable.
function resolveValue(opt, word) {
  const w = word.toLowerCase();
  const byValue = opt.opts.find(o => String(o.v).toLowerCase() === w);
  if (byValue) return byValue;
  const byLabel = opt.opts.find(o => o.t.toLowerCase() === w);
  if (byLabel) return byLabel;
  const prefixed = opt.opts.filter(o => o.t.toLowerCase().startsWith(w));
  return prefixed.length === 1 ? prefixed[0] : null;
}

// `ctx` carries whatever a derived option needs to resolve itself — today only
// the display rung, for Sound Detail. Absent (the Node smoke test) is fine: every
// `resolve` in the table has to answer without it.
function currentLabel(opt, settings, ctx) {
  const cur = String(effectiveOptionValue(opt, settings, ctx));
  const hit = opt.opts.find(o => String(o.v) === cur);
  return hit ? hit.t : cur;
}

function optionBlock(opt, settings, ctx) {
  const eff = String(effectiveOptionValue(opt, settings, ctx));
  const pills = opt.opts.map(o => {
    const on = eff === String(o.v);
    const cmd = `accessibility ${opt.verb} ${o.t.toLowerCase()}`;
    return on
      ? `<b>[${esc(o.t)}]</b>`
      : `<a href="#" data-cmd="${esc(cmd)}">${esc(o.t)}</a>`;
  }).join(' · ');
  return `<div style="margin:0.5em 0">`
    + `<b>${esc(opt.label)}</b> — currently <b>${esc(currentLabel(opt, settings, ctx))}</b><br>`
    + `<span style="color:var(--text-dim)">${esc(opt.why)}</span><br>`
    + `${pills}<br>`
    + `<span style="color:var(--text-dim)">accessibility ${esc(opt.verb)} &lt;option&gt;</span>`
    + `</div>`;
}

function listAll(settings, ctx) {
  // Display Mode is not in A11Y_OPTIONS because it is server-side state, not a
  // localStorage preference — but it is the single most consequential thing on
  // this list, so it is named first rather than left for the player to find.
  return `<div class="system">`
    + `<b>ACCESSIBILITY</b><br>`
    + `<span style="color:var(--text-dim)">Every setting below applies immediately and is remembered on this device. `
    + `Nothing here is announced to anyone else, and none of it changes the game's difficulty.</span><br>`
    + `<div style="margin:0.5em 0">`
      + `<b>Display Mode</b> — how much of the game is drawn rather than written.<br>`
      + `<span style="color:var(--text-dim)">The biggest one. <b>log</b> writes everything into this log for a screen reader; `
      + `<b>textgames</b> keeps the graphics but gives every minigame a written form you can play at your own pace.</span><br>`
      + `<a href="#" data-cmd="displaymode visual">Visual</a> · `
      + `<a href="#" data-cmd="displaymode textgames">Text Games</a> · `
      + `<a href="#" data-cmd="displaymode log">Log</a><br>`
      + `<span style="color:var(--text-dim)">displaymode &lt;mode&gt;</span>`
    + `</div>`
    + A11Y_OPTIONS.map(o => optionBlock(o, settings, ctx)).join('')
    + `<span style="color:var(--text-dim)">All of this also lives in the tablet: Settings → Accessibility.</span>`
    + `</div>`;
}

export function runAccessibilityCommand(argstr, ctx) {
  const settings = loadSettings();
  const parts = (argstr || '').trim().split(/\s+/).filter(Boolean);

  if (!parts.length) return listAll(settings, ctx);

  const which = parts[0].toLowerCase();

  // `accessibility reset` — the escape hatch. Someone who has turned something on
  // that made things WORSE needs one word to get back, not a tour of six options.
  if (which === 'reset') {
    for (const opt of A11Y_OPTIONS) delete settings[opt.key];
    delete settings.fontSizeChosen;
    commit(loadSettingsMerged(settings));
    return `<div class="system">Accessibility settings reset to defaults.</div>`;
  }

  const opt = A11Y_OPTIONS.find(o => o.verb === which || o.key.toLowerCase() === which);
  if (!opt) {
    return `<div class="error">No accessibility setting called "${esc(parts[0])}". `
      + `Try: ${A11Y_OPTIONS.map(o => esc(o.verb)).join(', ')}, reset — or just <a href="#" data-cmd="accessibility">accessibility</a>.</div>`;
  }

  if (parts.length === 1) return `<div class="system">${optionBlock(opt, settings, ctx)}</div>`;

  const chosen = resolveValue(opt, parts.slice(1).join(' '));
  if (!chosen) {
    return `<div class="error">"${esc(parts.slice(1).join(' '))}" isn't an option for ${esc(opt.label)}. `
      + `Choose: ${opt.opts.map(o => esc(o.t)).join(', ')}.</div>`;
  }

  settings[opt.key] = chosen.v;
  // A size the player asked for outranks the phone's width auto-fit — same flag
  // the tablet's pill sets, for the same reason (see applyMobileScale).
  if (opt.key === 'fontSize') settings.fontSizeChosen = true;
  commit(settings);
  return `<div class="system">${esc(opt.label)} set to <b>${esc(chosen.t)}</b>.</div>`;
}

// Deleting a key leaves the object without it; re-running the loader's merge is
// what puts the DEFAULT back rather than leaving it undefined.
function loadSettingsMerged(stripped) {
  saveSettings(stripped);
  return loadSettings();
}
