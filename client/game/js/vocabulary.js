// The live noun vocabulary — what is nameable from where the player is standing
// right now.
//
// Two features read this: voice input's noun matcher (dictation.js) and Tab
// completion (complete.js). It lives in its own module because the second one
// arriving is exactly the moment a helper stops belonging to whichever feature
// happened to need it first — and because importing it out of dictation.js would
// have put input.js → complete.js → dictation.js → input.js in a cycle.
//
// Every source here is already on the page: the room pane and smartbar render
// literal commands into `data-cmd` attributes, and the inventory cache mirrors
// the last `inventory` payload. Nothing is fetched and no round trip is added.
// Assembled per call, never cached — the whole point is that it reflects the
// room, and a room is the thing that changes most often.
import { getEquipInventory } from './panels/inventory-state.js';

export function liveNouns() {
  const out = new Set();
  try {
    for (const el of document.querySelectorAll('[data-cmd]')) {
      const cmd = el.getAttribute('data-cmd') || '';
      const rest = cmd.split(/\s+/).slice(1).join(' ');
      if (rest) out.add(rest);
      const label = (el.textContent || '').trim();
      if (label && label.length < 40) out.add(label);
    }
  } catch { /* no DOM yet — the inventory half still works */ }
  for (const item of getEquipInventory() || []) if (item?.name) out.add(item.name);
  return [...out];
}
