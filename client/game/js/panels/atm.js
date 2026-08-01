import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';
import { openCircuitHack } from './circuithack.js';
import { sfx } from './minigame-common.js';

// ── Audio ─────────────────────────────────────────────────────────────────

// MAINTENANCE EJECT — the hopper forced open, then a rapid metallic cascade
// of chips clattering out (descending, irregularly-spaced clinks so it reads
// as a tumble rather than a mechanical loop), capped by the terminal seizing
// and dying mid-spark. Distinct from Circuit Breach's own SFX_FORCE/SFX_WIN:
// this is the payout itself, not the breach that unlocked it.
const SFX_DRAIN = { priority: 8, config: { duration: 1.05, layers: [
  // Hopper punched open.
  { waveform: 'triangle', freq: 85, pitchBend: { to: 32, time: 0.18 }, adsr: { a: 0.001, d: 0.16, s: 0, r: 0.12 }, gain: 0.42 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 480, q: 1.4 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.08 }, gain: 0.32 },
  // Chip cascade — descending metallic clinks, tumbling out.
  { waveform: 'square', freq: 1900, delay: 0.13, filter: { type: 'bandpass', freq: 1900, q: 6 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.17 },
  { waveform: 'triangle', freq: 1640, delay: 0.185, filter: { type: 'bandpass', freq: 1640, q: 6 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.16 },
  { waveform: 'square', freq: 1780, delay: 0.235, filter: { type: 'bandpass', freq: 1780, q: 6 }, adsr: { a: 0.001, d: 0.045, s: 0, r: 0.03 }, gain: 0.16 },
  { waveform: 'triangle', freq: 1400, delay: 0.30, filter: { type: 'bandpass', freq: 1400, q: 5.5 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.15 },
  { waveform: 'square', freq: 1550, delay: 0.355, filter: { type: 'bandpass', freq: 1550, q: 5.5 }, adsr: { a: 0.001, d: 0.045, s: 0, r: 0.03 }, gain: 0.14 },
  { waveform: 'triangle', freq: 1160, delay: 0.415, filter: { type: 'bandpass', freq: 1160, q: 5 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.035 }, gain: 0.13 },
  { waveform: 'square', freq: 1280, delay: 0.47, filter: { type: 'bandpass', freq: 1280, q: 5 }, adsr: { a: 0.001, d: 0.045, s: 0, r: 0.03 }, gain: 0.12 },
  { waveform: 'triangle', freq: 940, delay: 0.53, filter: { type: 'bandpass', freq: 940, q: 4.5 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.11 },
  { waveform: 'square', freq: 1040, delay: 0.59, noiseMix: 0.35, filter: { type: 'bandpass', freq: 1040, q: 4 }, adsr: { a: 0.001, d: 0.065, s: 0, r: 0.05 }, gain: 0.1 },
  { waveform: 'triangle', freq: 760, delay: 0.655, noiseMix: 0.3, filter: { type: 'bandpass', freq: 760, q: 4 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 }, gain: 0.09 },
  // Terminal seizes and dies — descending power-down whine + a last spark.
  { waveform: 'sawtooth', freq: 260, delay: 0.62, pitchBend: { to: 28, time: 0.32 }, filter: { type: 'lowpass', freq: 1200, q: 1 }, adsr: { a: 0.01, d: 0.28, s: 0.15, r: 0.22 }, gain: 0.24 },
  { waveform: 'noise', noiseMix: 1, delay: 0.66, filter: { type: 'highpass', freq: 3200, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.2 },
] } };
export function playAtmDrainSfx() { window.AudioEngine?.init?.(); sfx(SFX_DRAIN); }

let atmData = null;
// The CRT is menu-driven: 'home' shows the option list, the others are the
// screens you drill into from it. Kept in module state so live balance pushes
// (updateAtmPanel) re-render whatever screen the player is currently on.
let screen = 'home'; // home | deposit | withdraw | account | maintenance

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
  if (patch.hasHackDevice != null) atmData.hasHackDevice = patch.hasHackDevice;
  // A transaction returns only the direction it spent, and only its new
  // `remaining` — merge per-direction so the untouched bucket keeps its figures,
  // and derive `spent` locally so the "X of Y left" line is right immediately
  // rather than one panel-open behind.
  if (patch.allowance && atmData.allowance) {
    for (const dir of ['deposit', 'withdraw']) {
      const left = patch.allowance[dir];
      if (left == null) continue;
      const cur = atmData.allowance[dir] || { remaining: 0, spent: 0, resetsIn: 0 };
      atmData.allowance[dir] = {
        remaining: left,
        spent: Math.max(0, (atmData.txnCap ?? 0) - left),
        // The window now starts at this transaction unless an older one is still
        // inside it, so the existing wait is the floor, never shorter.
        resetsIn: cur.resetsIn > 0 ? cur.resetsIn : 24 * 3600,
      };
    }
  }
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
  else if (screen === 'maintenance') scr.innerHTML = renderMaintenance(data);
  else if (screen === 'deposit' || screen === 'withdraw') scr.innerHTML = renderTx(data, screen);
  else scr.innerHTML = renderHome(data);

  wireScreen();
}

function renderHome(data) {
  const { player, cashStock, maintenanceUnlocked, hasHackDevice } = data;
  // The breach port only appears when the player is physically carrying a
  // hacking deck — no device, no port to plug into.
  const jackItem = hasHackDevice
    ? `<button class="atm-menu-item atm-menu-danger" data-act="jack"${cashStock > 0 ? '' : ' disabled'}><span class="atm-menu-key">⎔</span>DATAPORT<span class="atm-menu-hint">${cashStock > 0 ? 'jack in' : 'empty'}</span></button>`
    : '';
  // Unlocked MAINTENANCE glows in the player's own theme accent (not the
  // network colour) to read as *their* illicit foothold on the terminal.
  const maintenanceItem = maintenanceUnlocked
    ? `<button class="atm-menu-item atm-menu-glow" style="--atm-accent:var(--accent)" data-nav="maintenance"><span class="atm-menu-key">⚙</span>MAINTENANCE<span class="atm-menu-hint">access unlocked</span></button>`
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
      ${jackItem}
      ${maintenanceItem}
    </div>`;
}

// "3h 20m" until a spent allowance starts coming back. Mirrors the server's
// fmtWindowWait; the value is a snapshot from the last payload, not a live clock.
function fmtWait(sec) {
  if (!sec || sec <= 0) return 'shortly';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

function renderTx(data, mode) {
  const { player, network, txnCap } = data;
  const isDep = mode === 'deposit';
  const avail = isDep ? `Carried: ${formatC(player.credits)}` : `Banked: ${formatC(player.bank_credits)}`;
  const feeLine = (!isDep && network.fee_rate > 0)
    ? `<div class="atm-scr-fee">Network fee: ${Math.round(network.fee_rate * 100)}% on withdrawal</div>` : '';
  // State the ceiling up front rather than letting the machine refuse after the
  // fact — and once any of it is spent, show what's LEFT, because that's the only
  // number the player can act on. The allowance is a rolling 24h window per
  // network, so an exhausted one names the wait rather than reading as a dead end.
  const allow = data.allowance?.[mode];
  let capLine = '';
  if (txnCap != null) {
    if (!allow || allow.spent <= 0) {
      capLine = `<div class="atm-scr-fee">24h limit: ${formatC(txnCap)} — larger sums, see a teller</div>`;
    } else if (allow.remaining > 0) {
      capLine = `<div class="atm-scr-fee">24h limit: ${formatC(allow.remaining)} of ${formatC(txnCap)} left — resets in ${fmtWait(allow.resetsIn)}</div>`;
    } else {
      capLine = `<div class="atm-scr-fee atm-scr-spent">24h limit reached — ${formatC(txnCap)} moved. Resets in ${fmtWait(allow.resetsIn)}, or see a teller</div>`;
    }
  }
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
    ${capLine}
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

function renderMaintenance(data) {
  const { cashStock } = data;
  const has = cashStock > 0;
  return `
    <div class="atm-scr-top">
      <button class="atm-back" data-nav="home">‹ BACK</button>
      <span class="atm-scr-title">MAINTENANCE</span>
      <span></span>
    </div>
    <div class="atm-scr-avail">Diagnostic shell access active. Cash reserve can be force-ejected from the hopper — this will brick the terminal.</div>
    <div class="atm-scr-reserve">
      <div class="atm-scr-reserve-lbl">CASH RESERVE</div>
      <div class="atm-scr-reserve-val">${cashStock.toLocaleString()}c</div>
    </div>
    <button class="atm-confirm atm-confirm-danger" data-act="drain"${has ? '' : ' disabled'}>${has ? 'EJECT ALL CREDITS' : 'RESERVE EMPTY'}</button>`;
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
    // Deposit caps at carried cash; withdraw caps at the machine's cash stock and what the bank
    // balance covers after the fee. Both are then clamped to what's LEFT of this direction's
    // rolling 24h allowance (server-supplied, null at a teller's counter) — bigger sums have to
    // be walked into the bank, so MAX must never propose an amount the terminal will refuse.
    // Clamping to `txnCap` alone would over-propose the moment any of it has been spent.
    const { player, network, cashStock, txnCap } = atmData;
    const allowLeft = atmData.allowance?.[screen]?.remaining;
    let max;
    if (screen === 'deposit') {
      max = player.credits || 0;
    } else {
      const feeRate = network.fee_rate || 0;
      const maxByFunds = feeRate > 0 ? Math.floor((player.bank_credits || 0) / (1 + feeRate)) : (player.bank_credits || 0);
      max = Math.min(cashStock, maxByFunds);
    }
    if (txnCap != null) max = Math.min(max, allowLeft != null ? allowLeft : txnCap);
    if (field) field.value = Math.max(0, max);
  } else if (act === 'jack') {
    // JACK → Circuit Breach minigame overlay. There is no server-side skill
    // roll anymore: winning the minigame IS the breach. The only server-side
    // gate is carrying a hacking device (checked again at `jackresolve` in
    // case the panel's client-side `canJack` gate is stale or bypassed).
    openCircuitHack({
      skill: atmData.hackingSkill ?? 4,
      difficulty: atmData.hackDifficulty ?? 6,
      atmName: atmData.name,
      accent: atmData.network.color || '#00ff88',
      onResult: ({ won }) => { sendCmdSilent(`jackresolve ${atmData.atmId} ${won ? 1 : 0}`); },
    });
  } else if (act === 'drain') {
    screen = 'home';
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
