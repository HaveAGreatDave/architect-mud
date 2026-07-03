import { state } from '../state.js';
import { sendDialogue, buyFromNpc, sellToNpc, sellAllToNpc, sendRaw } from '../net.js';

const ITEMS_PER_PAGE = 10;
let shopState = null; // { msg, page, mode, sort }

const SORTS = [
  { key: 'alpha', label: 'A–Z' },
  { key: 'value', label: 'Value' },
  { key: 'weight', label: 'Weight' },
];

function sortItems(list, sort) {
  const sorted = [...list];
  if (sort === 'value') sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (sort === 'weight') sorted.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  else sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return sorted;
}

function formatWeight(g) {
  if (g == null) return '';
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10)}kg`;
}

// Reactive purchase feedback: a green pulse when a buy/sell lands, a red shake
// when it bounces (no credits). Fired from the dispatch handler on a fresh
// server result only, so tab/sort/page re-renders don't re-trigger it.
export function flashShopResult(ok) {
  const el = document.getElementById('dialogue-text');
  if (!el) return;
  el.classList.remove('shop-flash-ok', 'shop-flash-bad');
  void el.offsetWidth; // reflow so the animation restarts on repeat purchases
  el.classList.add(ok ? 'shop-flash-ok' : 'shop-flash-bad');
  setTimeout(() => el.classList.remove('shop-flash-ok', 'shop-flash-bad'), 650);
}

function formatOptionLabel(raw) {
  const stripped = raw.replace(/^\[gated\]\s*/i, '');
  const wasGated = stripped !== raw;
  return { label: stripped, gated: wasGated };
}

export function openDialogue(msg) {
  state.currentNpcId = msg.npcId;
  shopState = null;
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-text').innerHTML = msg.text;
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  for (let i = 0; i < (msg.options || []).length; i++) {
    const opt = msg.options[i];
    if (!opt.next) continue;
    const rawLabel = opt.text || opt.label || '';
    const { label, gated } = formatOptionLabel(rawLabel);
    const btn = document.createElement('button');
    btn.className = 'dialogue-opt';
    if (gated) {
      btn.innerHTML = `<span class="dialogue-opt-branch">↳</span>${label}`;
    } else {
      btn.textContent = label;
    }
    btn.onclick = () => sendDialogue(state.currentNpcId, opt.next, i);
    opts.appendChild(btn);
  }
  document.getElementById('dialogue-panel').classList.add('active');
}

export function closeDialogue() {
  document.getElementById('dialogue-panel').classList.remove('active');
  if (shopState) sendRaw({ type: 'shop_close' });
  state.currentNpcId = null;
  shopState = null;
}

export function openShop(msg, page = 0, mode, sort) {
  state.currentNpcId = msg.npcId;
  // Infer the active tab: a sell/buy result keeps you on that tab; otherwise preserve
  // the prior tab across refreshes, defaulting to Buy on first open.
  if (!mode) mode = msg.sellResult ? 'sell' : msg.buyResult ? 'buy' : (shopState?.mode || 'buy');
  if (!sort) sort = shopState?.sort || 'alpha';
  shopState = { msg, page, mode, sort };

  document.getElementById('dialogue-npc-name').textContent = msg.npcName;

  const list = sortItems(mode === 'sell' ? (msg.inventory || []) : (msg.stock || []), sort);
  const totalPages = Math.max(1, Math.ceil(list.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = list.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  // NB: #dialogue-text renders white-space:pre-wrap, so this HTML must stay
  // newline-free or every line break becomes visible blank space in the panel.
  let html = `<div class="shop-body">`;
  html += `<div class="shop-credits">Credits: <span style="color:var(--accent2);font-weight:bold">${msg.credits ?? 0}₵</span></div>`;
  html += `<div class="shop-tabs"><button class="shop-tab${mode === 'buy' ? ' active' : ''}" data-mode="buy">Buy</button><button class="shop-tab${mode === 'sell' ? ' active' : ''}" data-mode="sell">Sell</button></div>`;
  html += `<div class="shop-sort">Sort:${SORTS.map(s => `<button class="shop-sort-btn${sort === s.key ? ' active' : ''}" data-sort="${s.key}">${s.label}</button>`).join('')}</div>`;
  const resultText = mode === 'sell' ? msg.sellResult : msg.buyResult;
  const resultOk = mode === 'sell' ? msg.sellSuccess : msg.buySuccess;
  if (resultText) {
    const color = resultOk ? 'var(--green, #4ade80)' : 'var(--red)';
    html += `<div class="shop-result" style="color:${color}">${resultText}</div>`;
  }
  if (pageItems.length) {
    for (const item of pageItems) {
      const weight = item.weight != null ? `<span class="shop-item-weight">${formatWeight(item.weight)}</span>` : '';
      const desc = item.description ? `<div class="shop-item-desc">${item.description}</div>` : '';
      if (mode === 'sell') {
        const qty = item.quantity > 1 ? ` <span class="shop-item-desc">×${item.quantity}</span>` : '';
        const sellStack = item.quantity > 1
          ? `<button class="dialogue-opt shop-buy-btn shop-sell-btn shop-sell-stack-btn" data-inventory-id="${item.inventory_id}" data-npc-id="${msg.npcId}" data-quantity="${item.quantity}">Sell all (${item.quantity}) — ${item.price * item.quantity}₵</button>`
          : '';
        html += `<div class="shop-item"><div class="shop-item-row"><span class="shop-item-name">${item.name}${qty}${weight}</span><div class="shop-item-btns"><button class="dialogue-opt shop-buy-btn shop-sell-btn" data-inventory-id="${item.inventory_id}" data-npc-id="${msg.npcId}">${item.price}₵ — Sell</button>${sellStack}</div></div>${desc}</div>`;
      } else {
        html += `<div class="shop-item"><div class="shop-item-row"><span class="shop-item-name">${item.name}${weight}</span><button class="dialogue-opt shop-buy-btn" data-item-id="${item.item_id}" data-npc-id="${msg.npcId}">${item.price}₵ — Buy</button></div>${item.discounted ? '<span class="shop-discount">(rep discount applied)</span>' : ''}${desc}</div>`;
      }
    }
    if (totalPages > 1) {
      html += `<div class="shop-pager">`;
      if (safePage > 0) html += `<button class="dialogue-opt shop-prev-btn">← Prev</button>`;
      html += `<span class="shop-page-label">Page ${safePage + 1} / ${totalPages}</span>`;
      if (safePage < totalPages - 1) html += `<button class="dialogue-opt shop-next-btn">Next →</button>`;
      html += `</div>`;
    }
  } else {
    html += `<div style="color:var(--text-dim)">${mode === 'sell' ? 'Nothing to sell.' : 'Nothing in stock.'}</div>`;
  }
  if (mode === 'sell' && list.length) {
    const totalQty = list.reduce((n, it) => n + (it.quantity || 1), 0);
    const totalValue = list.reduce((n, it) => n + (it.price || 0) * (it.quantity || 1), 0);
    html += `<button class="dialogue-opt shop-sell-all-btn" data-npc-id="${msg.npcId}">Sell All (${totalQty} item${totalQty === 1 ? '' : 's'}) — ${totalValue}₵</button>`;
  }
  html += `</div>`;

  document.getElementById('dialogue-text').innerHTML = html;

  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'dialogue-opt';
  backBtn.textContent = '← Back';
  backBtn.onclick = () => sendDialogue(msg.npcId, 'root');
  opts.appendChild(backBtn);

  document.querySelectorAll('.shop-tab').forEach(btn => {
    btn.addEventListener('click', () => openShop(shopState.msg, 0, btn.dataset.mode));
  });

  document.querySelectorAll('.shop-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => openShop(shopState.msg, 0, mode, btn.dataset.sort));
  });

  document.querySelectorAll('.shop-sell-btn:not(.shop-sell-stack-btn)').forEach(btn => {
    btn.addEventListener('click', () => sellToNpc(btn.dataset.npcId, btn.dataset.inventoryId));
  });

  document.querySelectorAll('.shop-sell-stack-btn').forEach(btn => {
    btn.addEventListener('click', () => sellToNpc(btn.dataset.npcId, btn.dataset.inventoryId, Number(btn.dataset.quantity)));
  });

  const sellAllBtn = document.querySelector('.shop-sell-all-btn');
  if (sellAllBtn) sellAllBtn.addEventListener('click', () => sellAllToNpc(sellAllBtn.dataset.npcId));
  document.querySelectorAll('.shop-buy-btn:not(.shop-sell-btn)').forEach(btn => {
    btn.addEventListener('click', () => buyFromNpc(btn.dataset.npcId, btn.dataset.itemId));
  });

  const prevBtn = document.querySelector('.shop-prev-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => openShop(shopState.msg, shopState.page - 1, mode));

  const nextBtn = document.querySelector('.shop-next-btn');
  if (nextBtn) nextBtn.addEventListener('click', () => openShop(shopState.msg, shopState.page + 1, mode));

  document.getElementById('dialogue-panel').classList.add('active');
}

export function initDialogue() {
  document.getElementById('dialogue-close').addEventListener('click', closeDialogue);
  document.getElementById('dialogue-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dialogue-panel')) closeDialogue();
  });
  document.querySelectorAll('#dialogue-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Leave')) btn.addEventListener('click', closeDialogue);
  });
}
