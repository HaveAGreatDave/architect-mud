import { state } from '../state.js';
import { sendDialogue, buyFromNpc, sendRaw } from '../net.js';

const ITEMS_PER_PAGE = 10;
let shopState = null; // { msg, page }

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

export function openShop(msg, page = 0) {
  state.currentNpcId = msg.npcId;
  shopState = { msg, page };

  document.getElementById('dialogue-npc-name').textContent = msg.npcName;

  const stock = msg.stock || [];
  const totalPages = Math.max(1, Math.ceil(stock.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = stock.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  let html = `<div class="shop-body">`;
  html += `<div class="shop-credits">Credits: <span style="color:var(--accent2);font-weight:bold">${msg.credits ?? 0}₵</span></div>`;
  if (msg.buyResult) {
    const color = msg.buySuccess ? 'var(--green, #4ade80)' : 'var(--red)';
    html += `<div class="shop-result" style="color:${color}">${msg.buyResult}</div>`;
  }
  if (pageItems.length) {
    for (const item of pageItems) {
      html += `<div class="shop-item">
        <div class="shop-item-row">
          <span class="item-rarity-${item.rarity} shop-item-name">${item.name}</span>
          <button class="dialogue-opt shop-buy-btn" data-item-id="${item.item_id}" data-npc-id="${msg.npcId}">${item.price}₵ — Buy</button>
        </div>
        ${item.discounted ? '<span class="shop-discount">(rep discount applied)</span>' : ''}
        <div class="shop-item-desc">${item.description}</div>
      </div>`;
    }
    if (totalPages > 1) {
      html += `<div class="shop-pager">`;
      if (safePage > 0) html += `<button class="dialogue-opt shop-prev-btn">← Prev</button>`;
      html += `<span class="shop-page-label">Page ${safePage + 1} / ${totalPages}</span>`;
      if (safePage < totalPages - 1) html += `<button class="dialogue-opt shop-next-btn">Next →</button>`;
      html += `</div>`;
    }
  } else {
    html += '<div style="color:var(--text-dim)">Nothing in stock.</div>';
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

  document.querySelectorAll('.shop-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => buyFromNpc(btn.dataset.npcId, btn.dataset.itemId));
  });

  const prevBtn = document.querySelector('.shop-prev-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => openShop(shopState.msg, shopState.page - 1));

  const nextBtn = document.querySelector('.shop-next-btn');
  if (nextBtn) nextBtn.addEventListener('click', () => openShop(shopState.msg, shopState.page + 1));

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
