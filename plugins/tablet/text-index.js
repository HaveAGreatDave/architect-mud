// The tablet, as a list of things you can type.
//
// At the `log` rung of Display Mode (docs/systems-display-mode.md) the tablet shell
// is unusable — it's a fullscreen graphical OS, and the switch that put the player
// there lives inside it. `tablet`/`os` route here instead, so the same gesture that
// normally raises the device (the smartbar Tablet chip sends the literal verb) gets
// a typed index of what the device is FOR.
//
// The rule this follows: **it lists verbs, never screens.** Every line is something
// the player can type at the prompt and have happen. An app whose only route in is
// the graphical screen is still listed — with `tabletnav <id>` — because knowing the
// feature exists and is currently out of reach beats it being invisible, but it is
// listed LAST inside its category and dimmed, so the typeable half reads first.
//
// Verbs come from the appDef's own `verbs: []` (registry.js), not from a table here:
// an app that lives in another plugin (flight's DEADHEAD, consort's BLISS) has to be
// able to declare its own, and a second list in this file would rot the first time
// somebody renamed a verb.
import { getTabletApps } from './registry.js';

// Category order — the same rough grouping the Home screen uses, with the two
// categories a text player reaches for first pulled to the top. Anything with a
// category not named here sorts after these, alphabetically.
const CATEGORY_ORDER = ['System', 'General', 'Progression', 'Navigation', 'Finance',
  'Assets', 'Social', 'Media', 'Reference', 'Espionage', 'Fun'];

function catRank(c) {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Visible apps only — the same `visible` gate buildHomePayload runs, so an app you
// haven't unlocked is no more discoverable here than it is on the Home screen. The
// widget/buildHome calls are deliberately NOT made: this is a list of names, and a
// broken widget must not cost anybody their index.
async function visibleApps(player) {
  const out = [];
  for (const app of getTabletApps()) {
    if (typeof app.visible === 'function') {
      try { if (!(await app.visible(player))) continue; } catch { /* default visible */ }
    }
    out.push(app);
  }
  return out;
}

/**
 * buildTextIndex(player) → a `help`-typed payload listing every tablet feature as
 * verbs. Used by `tablet`/`os` at the log rung, and reachable at any rung by
 * `tablet verbs` — a player in visual mode helping one in log mode needs to be able
 * to read the same list.
 */
export async function buildTextIndex(player) {
  const apps = await visibleApps(player);
  const byCat = new Map();
  for (const app of apps) {
    const cat = app.category || 'General';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(app);
  }

  let msg = '<span class="help-header">TABLET — WHAT YOU CAN TYPE</span>';
  msg += '\n<span class="text-dim">Display Mode is set to log, so the tablet answers in text.'
       + ' `displaymode visual` brings the screen back.</span>';

  const cats = [...byCat.keys()].sort((a, b) => (catRank(a) - catRank(b)) || a.localeCompare(b));
  for (const cat of cats) {
    // Typeable apps first, then the screen-only ones, each half alphabetical — so
    // the reader hits every real verb in a category before the dimmed remainder.
    const list = byCat.get(cat).slice().sort((a, b) => {
      const av = (a.verbs?.length ? 0 : 1), bv = (b.verbs?.length ? 0 : 1);
      return (av - bv) || String(a.name).localeCompare(String(b.name));
    });
    msg += `\n\n<span class="help-category">${String(cat).toUpperCase()}</span>`;
    for (const app of list) {
      const verbs = (app.verbs || []).filter(Boolean);
      const route = verbs.length
        ? verbs.join('  |  ')
        : `<span class="text-dim">tabletnav ${app.id}  — screen only</span>`;
      msg += `\n  ${String(app.name).padEnd(16)}${route}`;
    }
  }

  msg += '\n\n<span class="text-dim">Anything not listed with a verb is a screen; '
       + '`tabletnav &lt;app&gt;` still opens it, but it will not read well here.</span>';
  return { type: 'help', message: msg };
}
