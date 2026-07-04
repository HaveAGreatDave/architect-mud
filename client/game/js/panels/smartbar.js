// Mobile smart action bar. A contextual, thumb-height row of verb buttons that
// re-reads the current room from #area-content on every look/move (driven by
// parseZoneInfo) and surfaces only the verbs that apply here. Tapping a verb
// with one target fires it immediately (target inferred); several targets open
// a client-side bottom-sheet chooser; none = the button isn't shown.
//
// No new server data: every actionable room entity already ships as a
// .action-link span carrying data-action + data-target (see describe.js). This
// module is just a thumb-friendly re-presentation of those links, reusing the
// exact command formula from handleActionLinkClick in main.js.
import { sendCmd } from '../net.js';

// The room verbs we surface, in display order, with their button labels. Only
// these data-action values become smart buttons — exits/doors already drive the
// d-pad, and inventory/shop verbs aren't in the room HTML.
const VERBS = [
  { action: 'attack',  label: 'Attack'  },
  { action: 'talk',    label: 'Talk'    },
  { action: 'take',    label: 'Take'    },
  { action: 'loot',    label: 'Loot'    },
  { action: 'examine', label: 'Examine' },
];

// Fire a chosen (verb, candidate) pair using the same command shape as clicking
// the inline .action-link: `${verb} ${target}` lowercased, with a friendly log
// label when the candidate carries one (corpses target a numeric id + label).
function fireAction(action, cand) {
  const cmd = `${action} ${String(cand.target).toLowerCase()}`;
  sendCmd(cmd, cand.label ? `${action} ${cand.label}` : undefined);
}

let _sheet = null;

function closeSheet() {
  _sheet?.remove();
  _sheet = null;
}

// Bottom-sheet target chooser: one big tap button per candidate. Replaces the
// server's numbered SIFT disambiguation for the mobile path.
function openTargetSheet(action, label, candidates) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'smart-sheet-overlay';
  overlay.innerHTML = `
    <div class="smart-sheet">
      <div class="smart-sheet-title">${label}</div>
      <div class="smart-sheet-list"></div>
      <button class="smart-sheet-cancel">Cancel</button>
    </div>`;
  const list = overlay.querySelector('.smart-sheet-list');
  for (const cand of candidates) {
    const btn = document.createElement('button');
    btn.className = 'smart-sheet-item';
    btn.textContent = cand.label;
    btn.addEventListener('click', () => { fireAction(action, cand); closeSheet(); });
    list.appendChild(btn);
  }
  overlay.querySelector('.smart-sheet-cancel').addEventListener('click', closeSheet);
  // Tap outside the sheet dismisses without sending anything.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);
  _sheet = overlay;
}

// Rebuild the smart bar from the live room. Called from parseZoneInfo on every
// look/move, so it always tracks the current room.
export function renderSmartBar() {
  const bar = document.getElementById('smart-bar');
  if (!bar) return;
  const area = document.getElementById('area-content');

  // Group current room action-links by verb.
  const byAction = {};
  if (area) {
    for (const el of area.querySelectorAll('span.action-link[data-action][data-target]')) {
      const action = el.dataset.action;
      const target = el.dataset.target;
      if (!action || !target) continue;
      (byAction[action] ||= []).push({
        target,
        label: el.dataset.label || el.textContent.trim(),
        action,
      });
    }
  }

  bar.textContent = '';
  let count = 0;
  for (const { action, label } of VERBS) {
    const cands = byAction[action];
    if (!cands || !cands.length) continue;
    count++;
    const btn = document.createElement('button');
    btn.className = 'smart-btn';
    btn.textContent = cands.length > 1 ? `${label} (${cands.length})` : label;
    btn.addEventListener('click', () => {
      if (cands.length === 1) fireAction(action, cands[0]);
      else openTargetSheet(action, label, cands);
    });
    bar.appendChild(btn);
  }

  // Collapse the row entirely when the room offers no actions.
  bar.classList.toggle('smart-bar-empty', count === 0);
}
