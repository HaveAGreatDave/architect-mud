import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';
import { openCircuitHack } from './circuithack.js';

let atmData = null;
// The CRT is menu-driven: 'home' shows the option list, the others are the
// screens you drill into from it. Kept in module state so live balance pushes
// (updateAtmPanel) re-render whatever screen the player is currently on.
let screen = 'home'; // home | deposit | withdraw | account

export function openAtmPanel(data) {
  atmData = data;
  screen = 'home';
  renderAtmPanel();
  document.getElementById('atm-panel').classList.add('active');
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
  if (patch.maintenanceUnlocked != null) atmData.maintenanceUnlocked = patch.maintenanceUnlocked;
  renderAtmPanel();
}

function formatC(n) {
  return '₵ ' + (n ?? 0).toLocaleString();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderAtmPanel() {
  const data = atmData;
  if (!data) return;
  const { network, powered, isBroken } = data;

  // Network branding — the accent colour themes the whole terminal (chassis glow,
  // CRT phosphor, menu, bars all derive from --atm-accent via color-mix in the CSS).
  const accent = network.color || '#00ff88';
  const box = document.getElementById('atm-box');
  box.style.setProperty('--atm-accent', accent);
  document.getElementById('atm-network-name').textContent = network.name;

  const operational = !isBroken && powered;

  // Physical power LED + chassis status legend.
  const powerEl = document.getElementById('atm-power-status');
  const led = document.getElementById('atm-power-led');
  powerEl.textContent = isBroken ? 'DAMAGED' : (!powered ? 'NO POWER' : 'ONLINE');
  led.classList.toggle('atm-led-off', !operational);
  box.classList.toggle('atm-dark', !operational);

  const scr = document.getElementById('atm-crt-screen');

  if (!operational) {
    scr.innerHTML = `<div class="atm-crt-offline">
      <div class="atm-off-glyph">⚠</div>
      <div class="atm-off-msg">TERMINAL OFFLINE\n[ ${isBroken ? 'DAMAGED' : 'NO POWER'} ]</div>
    </div>`;
    return;
  }

  if (screen === 'account') scr.innerHTML = renderAccount(data);
  else if (screen === 'deposit' || screen === 'withdraw') scr.innerHTML = renderTx(data, screen);
  else scr.innerHTML = renderHome(data);

  wireScreen();
}

function renderHome(data) {
  const { player, cashStock, maintenanceUnlocked } = data;
  const canJack = cashStock > 0;
  const maintenanceItem = maintenanceUnlocked
    ? `<button class="atm-menu-item atm-menu-danger" data-act="drain"><span class="atm-menu-key">☠</span>MAINTENANCE<span class="atm-menu-hint">eject all credits</span></button>`
    : '';
  return `
    <div class="atm-scr-top">
      <span class="atm-scr-title">${esc(data.network.name)}</span>
      <span class="atm-scr-online">◤ ONLINE ◥</span>
    </div>
    <div class="atm-scr-bal">
      <div class="atm-scr-balrow"><span>CARRIED</span><b>${formatC(player.credits)}</b></div>
      <div class="atm-scr-balrow"><span>BANKED</span><b>${formatC(player.bank_credits)}</b></div>
    </div>
    <div class="atm-menu">
      <button class="atm-menu-item" data-nav="deposit"><span class="atm-menu-key">▸</span>DEPOSIT<span class="atm-menu-hint">cash → bank</span></button>
      <button class="atm-menu-item" data-nav="withdraw"><span class="atm-menu-key">▸</span>WITHDRAW<span class="atm-menu-hint">bank → cash</span></button>
      <button class="atm-menu-item" data-nav="account"><span class="atm-menu-key">▸</span>ACCOUNT INFO<span class="atm-menu-hint">balances</span></button>
      <button class="atm-menu-item atm-menu-danger" data-act="jack"${canJack ? '' : ' disabled'}><span class="atm-menu-key">⚡</span>JACK TERMINAL<span class="atm-menu-hint">${canJack ? 'breach' : 'empty'}</span></button>
      ${maintenanceItem}
    </div>`;
}

function renderTx(data, mode) {
  const { player, network } = data;
  const isDep = mode === 'deposit';
  const avail = isDep ? `Carried: ${formatC(player.credits)}` : `Banked: ${formatC(player.bank_credits)}`;
  const feeLine = (!isDep && network.fee_rate > 0)
    ? `<div class="atm-scr-fee">Network fee: ${Math.round(network.fee_rate * 100)}% on withdrawal</div>` : '';
  return `
    <div class="atm-scr-top">
      <button class="atm-back" data-nav="home">‹ BACK</button>
      <span class="atm-scr-title">${isDep ? 'DEPOSIT' : 'WITHDRAW'}</span>
      <span></span>
    </div>
    <div class="atm-scr-avail">${avail}</div>
    <div class="atm-input-row">
      <input id="atm-amount" type="number" min="1" placeholder="AMOUNT" autocomplete="off">
      <button class="atm-key-btn" data-act="max">MAX</button>
    </div>
    ${feeLine}
    <button class="atm-confirm" data-act="${mode}">CONFIRM ${isDep ? 'DEPOSIT' : 'WITHDRAWAL'}</button>`;
}

function renderAccount(data) {
  const { player, network, cashStock, cashMax } = data;
  const pct = cashMax > 0 ? Math.round((cashStock / cashMax) * 100) : 0;
  const low = pct < 20;
  const feeLine = network.fee_rate > 0
    ? `<div class="atm-scr-fee">Withdrawal fee: ${Math.round(network.fee_rate * 100)}%</div>` : '';
  return `
    <div class="atm-scr-top">
      <button class="atm-back" data-nav="home">‹ BACK</button>
      <span class="atm-scr-title">ACCOUNT</span>
      <span></span>
    </div>
    <div class="atm-scr-bal">
      <div class="atm-scr-balrow"><span>CARRIED</span><b>${formatC(player.credits)}</b></div>
      <div class="atm-scr-balrow"><span>BANKED</span><b>${formatC(player.bank_credits)}</b></div>
    </div>
    <div class="atm-scr-reserve">
      <div class="atm-scr-reserve-lbl">CASH RESERVE</div>
      <div class="atm-bar-wrap"><div class="atm-bar-fill${low ? ' atm-bar-low' : ''}" style="width:${pct}%"></div></div>
      <div class="atm-scr-reserve-val">${cashStock.toLocaleString()}c / ${cashMax.toLocaleString()}c</div>
    </div>
    ${feeLine}`;
}

// Re-attach handlers after every render (innerHTML swap discards the old ones).
function wireScreen() {
  const scr = document.getElementById('atm-crt-screen');
  scr.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => {
    screen = el.dataset.nav;
    renderAtmPanel();
    if (screen === 'deposit' || screen === 'withdraw') document.getElementById('atm-amount')?.focus();
  }));
  scr.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => doAction(el.dataset.act)));
  document.getElementById('atm-amount')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAction(screen);
  });
}

function doAction(act) {
  if (!atmData) return;
  const field = document.getElementById('atm-amount');
  if (act === 'deposit') {
    const amt = field?.value.trim();
    if (!amt) return;
    sendCmdSilent(`deposit ${amt}`);
    if (field) field.value = '';
  } else if (act === 'withdraw') {
    const amt = field?.value.trim() || 'all';
    sendCmdSilent(`withdraw ${amt}`);
    if (field && amt !== 'all') field.value = '';
  } else if (act === 'max') {
    // Deposit caps at carried cash; withdraw caps at the min of machine stock,
    // network limit, and what the bank balance can cover after the fee.
    const { player, network, cashStock } = atmData;
    let max;
    if (screen === 'deposit') {
      max = player.credits || 0;
    } else {
      const feeRate = network.fee_rate || 0;
      const maxByCash = Math.min(cashStock, network.withdrawal_limit ?? 5000);
      const maxByFunds = feeRate > 0 ? Math.floor((player.bank_credits || 0) / (1 + feeRate)) : (player.bank_credits || 0);
      max = Math.min(maxByCash, maxByFunds);
    }
    if (field) field.value = Math.max(0, max);
  } else if (act === 'jack') {
    // JACK → Circuit Breach minigame overlay. The minigame is cosmetic flavour;
    // the server-side `jack` command is authoritative (runs the real hacking
    // skillCheck, enforces lockout/power/faction, and pays out). When the breach
    // resolves we fire `jack` and the server decides the true outcome.
    openCircuitHack({
      skill: atmData.hackingSkill ?? 4,
      difficulty: atmData.hackDifficulty ?? 6,
      atmName: atmData.name,
      cashStock: atmData.cashStock,
      onResult: () => { sendCmdSilent('jack'); },
    });
  } else if (act === 'drain') {
    sendCmdSilent('drain');
  }
}

export function initAtmPanel() {
  document.getElementById('atm-close').addEventListener('click', closeAtmPanel);
  document.getElementById('atm-panel').addEventListener('click', e => {
    if (e.target.id === 'atm-panel') closeAtmPanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && atmData) closeAtmPanel();
  });
}
