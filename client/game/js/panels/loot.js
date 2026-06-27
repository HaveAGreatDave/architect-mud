import { sendCmdSilent } from '../net.js';

let activeCorpseId = null;

export function openLootPanel(data) {
  activeCorpseId = data.corpseId;
  renderLootPanel(data);
  document.getElementById('loot-panel').classList.add('active');
}

export function refreshLootPanel(data) {
  if (!document.getElementById('loot-panel').classList.contains('active')) return;
  activeCorpseId = data.corpseId;
  renderLootPanel(data);
}

export function closeLootPanel() {
  const cid = activeCorpseId;
  document.getElementById('loot-panel').classList.remove('active');
  activeCorpseId = null;
  if (cid) sendCmdSilent(`closeloot ${cid}`);
}

export function getActiveCorpseId() { return activeCorpseId; }

function formatWeight(g) {
  g = Number(g) || 0;
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10).toString()}kg`;
}

function renderLootPanel(data) {
  document.getElementById('loot-title').textContent = data.corpseName;
  document.getElementById('loot-contents-label').textContent = data.corpseName;
  document.getElementById('loot-notify').textContent = data.notify || '';

  const list = document.getElementById('loot-contents-list');
  list.innerHTML = '';
  for (const item of data.items || []) {
    const card = document.createElement('div');
    card.className = 'ctr-item-card';
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const wt = item.weight != null ? ` ${formatWeight(item.weight)}` : '';
    card.innerHTML = `<span class="ctr-name">${item.name}${qty}</span><span class="ctr-meta">${item.rarity || ''}${wt}</span>`;
    const btn = document.createElement('button');
    btn.className = 'ctr-action-btn';
    btn.textContent = 'take';
    btn.title = 'Take from corpse';
    btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`lootid ${item.id} ${data.corpseId}`); };
    card.appendChild(btn);
    list.appendChild(card);
  }
  if (!(data.items || []).length) {
    const empty = document.createElement('div');
    empty.className = 'ctr-meta';
    empty.textContent = 'Nothing left to loot.';
    list.appendChild(empty);
  }

  document.getElementById('loot-butcher').style.display = data.butcherable ? '' : 'none';
}

export function initLootPanel() {
  document.getElementById('loot-close').addEventListener('click', closeLootPanel);
  document.getElementById('loot-close-btn').addEventListener('click', closeLootPanel);
  document.getElementById('loot-panel').addEventListener('click', (e) => {
    if (e.target.id === 'loot-panel') closeLootPanel();
  });
  document.getElementById('loot-butcher').addEventListener('click', () => {
    if (activeCorpseId) sendCmdSilent(`butcher ${activeCorpseId}`);
  });
}
