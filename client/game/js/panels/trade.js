// Two-panel trade window. The server (trade plugin) owns all state and renders the
// whole panel HTML; this client just injects it and relays button clicks back as
// the underlying `trade*` commands. Mirrors the poker "server renders, client
// shows" pattern, but in a dedicated centered modal instead of the area pane.
import { sendCmdSilent } from '../net.js';

let overlay = null;

export function initTradePanel() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'trade-overlay';
  overlay.innerHTML = '<div id="trade-box"><div id="trade-body"></div></div>';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  // One delegated handler for every button the server renders.
  overlay.addEventListener('click', (e) => {
    // Add an inventory item (optionally a quantity from the row's input).
    const add = e.target.closest('[data-add]');
    if (add) {
      const id = add.getAttribute('data-add');
      const qEl = overlay.querySelector(`[data-qty-for="${CSS.escape(id)}"]`);
      const qty = qEl ? Math.max(1, parseInt(qEl.value, 10) || 1) : 1;
      sendCmdSilent(`tradeoffer ${id} ${qty}`);
      return;
    }
    // Stake credits from the number field.
    if (e.target.closest('[data-credits-stake]')) {
      const inp = overlay.querySelector('#trade-credits-input');
      const n = Math.max(0, parseInt(inp?.value, 10) || 0);
      if (n > 0) sendCmdSilent(`tradeoffer credits ${n}`);
      return;
    }
    // Everything else is a literal command (retract / ready / cancel).
    const cmdEl = e.target.closest('[data-cmd]');
    if (cmdEl) sendCmdSilent(cmdEl.getAttribute('data-cmd'));
  });
}

export function updateTrade(html) {
  if (!overlay) initTradePanel();
  document.getElementById('trade-body').innerHTML = html;
  overlay.style.display = 'flex';
}

export function closeTrade() {
  if (overlay) overlay.style.display = 'none';
}
