import { sendCmdSilent, sendCmd } from '../net.js';
import { state } from '../state.js';

let atmData = null;

export function openAtmPanel(data) {
  atmData = data;
  renderAtmPanel(data);
  document.getElementById('atm-panel').classList.add('active');
  document.getElementById('atm-amount').focus();
}

export function closeAtmPanel() {
  document.getElementById('atm-panel').classList.remove('active');
  atmData = null;
}

export function updateAtmPanel(patch) {
  if (!atmData || !document.getElementById('atm-panel').classList.contains('active')) return;
  if (patch.cashStock != null) atmData.cashStock = patch.cashStock;
  if (patch.credits != null) atmData.player.credits = patch.credits;
  if (patch.bank_credits != null) atmData.player.bank_credits = patch.bank_credits;
  renderAtmPanel(atmData);
}

function formatC(n) {
  return '₵ ' + (n ?? 0).toLocaleString();
}

function renderAtmPanel(data) {
  const { network, cashStock, cashMax, powered, isBroken, player, name } = data;

  // Network branding
  document.getElementById('atm-network-name').textContent = network.name;
  document.getElementById('atm-network-name').style.color = network.color || '#00ff88';

  // Power / broken state
  const powerEl = document.getElementById('atm-power-status');
  if (isBroken) {
    powerEl.textContent = 'OFFLINE [DAMAGED]';
    powerEl.className = 'atm-value atm-offline';
  } else if (!powered) {
    powerEl.textContent = 'OFFLINE [NO POWER]';
    powerEl.className = 'atm-value atm-offline';
  } else {
    powerEl.textContent = 'ONLINE';
    powerEl.className = 'atm-value atm-online';
  }

  // Cash bar
  const pct = cashMax > 0 ? Math.round((cashStock / cashMax) * 100) : 0;
  document.getElementById('atm-cash-bar').style.width = pct + '%';
  document.getElementById('atm-cash-bar').className = 'atm-bar-fill' + (pct < 20 ? ' atm-bar-low' : '');
  document.getElementById('atm-cash-label').textContent = cashStock.toLocaleString() + 'c / ' + cashMax.toLocaleString() + 'c';

  // Balances
  document.getElementById('atm-carried').textContent = formatC(player.credits);
  document.getElementById('atm-banked').textContent = formatC(player.bank_credits);

  // Fee info
  const feeEl = document.getElementById('atm-fee-info');
  if (network.fee_rate > 0) {
    feeEl.textContent = `Network fee: ${Math.round(network.fee_rate * 100)}% on withdrawals`;
    feeEl.style.display = '';
  } else {
    feeEl.style.display = 'none';
  }

  // Disable buttons when not operational
  const disabled = isBroken || !powered;
  document.getElementById('atm-deposit-btn').disabled = disabled;
  document.getElementById('atm-withdraw-btn').disabled = disabled;
  document.getElementById('atm-jack-btn').disabled = isBroken || !powered || cashStock <= 0;
}

export function initAtmPanel() {
  document.getElementById('atm-close').addEventListener('click', closeAtmPanel);
  document.getElementById('atm-panel').addEventListener('click', e => {
    if (e.target.id === 'atm-panel') closeAtmPanel();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && atmData) closeAtmPanel();
  });

  document.getElementById('atm-deposit-btn').addEventListener('click', () => {
    const amt = document.getElementById('atm-amount').value.trim();
    if (!amt) return;
    sendCmdSilent(`deposit ${amt}`);
    document.getElementById('atm-amount').value = '';
  });

  document.getElementById('atm-withdraw-btn').addEventListener('click', () => {
    const amt = document.getElementById('atm-amount').value.trim() || 'all';
    sendCmdSilent(`withdraw ${amt}`);
    if (amt !== 'all') document.getElementById('atm-amount').value = '';
  });

  document.getElementById('atm-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('atm-deposit-btn').click();
  });

  document.getElementById('atm-jack-btn').addEventListener('click', () => {
    closeAtmPanel();
    sendCmd('jack atm');
  });

  // MAX button fills the withdraw amount with the maximum available
  document.getElementById('atm-max-btn').addEventListener('click', () => {
    if (!atmData) return;
    const { player, network, cashStock } = atmData;
    const feeRate = network.fee_rate || 0;
    const maxByCash = Math.min(cashStock, network.withdrawal_limit ?? 5000);
    const maxByFunds = feeRate > 0 ? Math.floor((player.bank_credits || 0) / (1 + feeRate)) : (player.bank_credits || 0);
    const max = Math.min(maxByCash, maxByFunds);
    document.getElementById('atm-amount').value = Math.max(0, max);
  });
}
