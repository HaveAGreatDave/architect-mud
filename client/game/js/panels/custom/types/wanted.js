import { getWantedStars } from '../../wanted.js';

// Optional sidebar readout of the player's wanted level. The value is pushed by
// the server (wanted_level → wanted.js); the manager re-renders this panel on
// each push, so we just read the current stars here.
export function renderWanted(bodyEl) {
  const n = getWantedStars();
  const full = Math.floor(n);
  const half = (n - full) >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));

  if (n <= 0) {
    bodyEl.innerHTML =
      `<div class="cpanel-wanted cpanel-wanted-clean">` +
        `<span class="cpanel-wanted-stars">${'☆'.repeat(5)}</span>` +
        `<span class="cpanel-wanted-note">Clean</span>` +
      `</div>`;
    return;
  }

  bodyEl.innerHTML =
    `<div class="cpanel-wanted">` +
      `<span class="cpanel-wanted-stars">${'★'.repeat(full)}${half ? '½' : ''}` +
        `<span class="cpanel-wanted-empty">${'☆'.repeat(empty)}</span></span>` +
    `</div>`;
}
