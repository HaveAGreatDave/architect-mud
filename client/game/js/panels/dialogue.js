import { state } from '../state.js';
import { sendDialogue, buyFromNpc } from '../net.js';

export function openDialogue(msg) {
  state.currentNpcId = msg.npcId;
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-text').innerHTML = msg.text;
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  for (const opt of (msg.options || [])) {
    if (!opt.next) continue;
    const btn = document.createElement('button');
    btn.className = 'dialogue-opt';
    btn.textContent = opt.label;
    btn.onclick = () => sendDialogue(state.currentNpcId, opt.next);
    opts.appendChild(btn);
  }
  document.getElementById('dialogue-panel').classList.add('active');
}

export function closeDialogue() {
  document.getElementById('dialogue-panel').classList.remove('active');
  state.currentNpcId = null;
}

export function openShop(msg) {
  state.currentNpcId = msg.npcId;
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;

  let html = `<div style="margin-bottom:10px;color:var(--text-dim);font-size:12px">Credits: <span style="color:var(--accent2);font-weight:bold">${msg.credits ?? 0}₵</span></div>`;
  if (msg.buyResult) {
    const color = msg.buySuccess ? 'var(--green, #4ade80)' : 'var(--red)';
    html += `<div style="margin-bottom:10px;font-size:12px;color:${color}">${msg.buyResult}</div>`;
  }
  if (msg.stock?.length) {
    for (const item of msg.stock) {
      html += `<div style="border:1px solid var(--border);padding:8px 10px;margin-bottom:6px;border-radius:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span class="item-rarity-${item.rarity}" style="font-weight:bold">${item.name}</span>
          <button class="dialogue-opt shop-buy-btn" style="padding:3px 10px;font-size:11px" data-item-id="${item.item_id}" data-npc-id="${msg.npcId}">${item.price}₵ — Buy</button>
        </div>
        ${item.discounted ? '<span style="font-size:10px;color:var(--green,#4ade80)">(rep discount applied)</span>' : ''}
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px">${item.description}</div>
      </div>`;
    }
  } else {
    html += '<div style="color:var(--text-dim)">Nothing in stock.</div>';
  }

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

  document.getElementById('dialogue-panel').classList.add('active');
}

export function initDialogue() {
  document.getElementById('dialogue-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dialogue-panel')) closeDialogue();
  });
  // Wire the static "[ Leave ]" button
  document.querySelectorAll('#dialogue-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Leave')) btn.addEventListener('click', closeDialogue);
  });
}
