import { state } from '../state.js';
import { appendMsg } from '../render.js';
import { sendDialogue, sendCmd, buyFromNpc, sellToNpc, sellAllToNpc, sendRaw } from '../net.js';

let shopState = null; // { msg, mode, sort, sel, qty }
// The zone the open dialogue/shop was started in. A conversation is face-to-face
// on one tile, so leaving it ends the conversation — whether the player walked
// off themselves or was moved (teleport, elevator, voidwalk, arrest, flight).
// Watched here rather than in each mover: every move path the player can observe
// repaints the room with a zone id, so this one check covers all of them.
let dialogueZone = null;

const SORTS = [
  { key: 'alpha', label: 'A–Z' },
  { key: 'value', label: 'Price' },
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

// Reactive purchase feedback lives on the credits counter: it rolls from the old
// balance to the new one, tinted red while spending and green while gaining.
// `lastShownCredits` is the value currently on screen; a null baseline (a fresh
// shop open) paints statically. `creditTween` is the in-flight interval so a
// rapid second transaction cancels the first.
let lastShownCredits = null;
let creditTween = null;

function animateCredits(target) {
  const wrap = document.querySelector('#dialogue-text .shop-cred');
  const el = wrap?.querySelector('b');
  if (!el) return;
  if (creditTween) { clearInterval(creditTween); creditTween = null; }
  const from = lastShownCredits == null ? target : lastShownCredits;
  lastShownCredits = target;
  wrap.classList.remove('cred-up', 'cred-down');
  if (from === target) { el.textContent = target; return; }
  wrap.classList.add(target > from ? 'cred-up' : 'cred-down');
  // Count by 1s for small changes; step larger so a big sale still settles in
  // ~600ms rather than ticking through hundreds of frames.
  const diff = target - from;
  const step = Math.max(1, Math.ceil(Math.abs(diff) / 30)) * Math.sign(diff);
  let cur = from;
  el.textContent = cur;
  creditTween = setInterval(() => {
    cur += step;
    if ((step > 0 && cur >= target) || (step < 0 && cur <= target)) {
      cur = target;
      clearInterval(creditTween); creditTween = null;
      setTimeout(() => wrap.classList.remove('cred-up', 'cred-down'), 350);
    }
    el.textContent = cur;
  }, 20);
}

function formatOptionLabel(raw) {
  const stripped = raw.replace(/^\[gated\]\s*/i, '');
  const wasGated = stripped !== raw;
  return { label: stripped, gated: wasGated };
}

export function openDialogue(msg) {
  state.currentNpcId = msg.npcId;
  dialogueZone = state.currentZone;
  shopState = null;
  document.getElementById('dialogue-panel').classList.remove('shop-mode');
  document.getElementById('dialogue-box').classList.remove('shop-mode');
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-text').innerHTML = msg.text;
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  for (let i = 0; i < (msg.options || []).length; i++) {
    const opt = msg.options[i];
    if (!opt.next && !opt.cmd) continue;
    const rawLabel = opt.text || opt.label || '';
    const { label, gated } = formatOptionLabel(rawLabel);
    const btn = document.createElement('button');
    btn.className = 'dialogue-opt';
    if (gated) {
      btn.innerHTML = `<span class="dialogue-opt-branch">↳</span>${label}`;
    } else {
      btn.textContent = label;
    }
    // A turn-in option for a quest you've accepted but not yet finished: the
    // server marks it disabled rather than hiding it, so you can see the hand-in
    // exists but can't misfire it. Clicking it isn't dead — it drops you into the
    // Tablet Quests screen for that quest so you can read what's still outstanding.
    if (opt._turninDisabled) {
      btn.classList.add('dialogue-opt-locked');
      btn.title = 'Finish this job first — tap to see what\'s left to do.';
      const qid = opt._turninQuestId;
      btn.onclick = () => { closeDialogue(); import('./tablet-os.js').then(m => m.openTabletToQuest(qid)); };
      opts.appendChild(btn);
      continue;
    }
    // A `cmd`-carrying option (e.g. "What's on the board?") jumps straight to
    // another UI (Tablet OS) instead of the next dialogue screen — close this
    // panel and run the command like any other action-link, rather than
    // round-tripping through sendDialogue.
    btn.onclick = opt.cmd ? () => { closeDialogue(); sendCmd(opt.cmd, label); } : () => sendDialogue(state.currentNpcId, opt.next, i);
    opts.appendChild(btn);
  }
  document.getElementById('dialogue-panel').classList.add('active');
}

export function closeDialogue() {
  document.getElementById('dialogue-panel').classList.remove('active', 'shop-mode');
  document.getElementById('dialogue-box').classList.remove('shop-mode');
  if (shopState) sendRaw({ type: 'shop_close' });
  if (creditTween) { clearInterval(creditTween); creditTween = null; }
  lastShownCredits = null;
  state.currentNpcId = null;
  shopState = null;
  dialogueZone = null;
}

// Called from the dispatch `look`/`move` handlers with the zone the client is
// now standing in. A different tile than the one the conversation started on
// closes the panel (the server has already dropped any shop session on its side).
export function notifyZoneChanged(zone) {
  if (!zone || !dialogueZone || zone === dialogueZone) return;
  if (!state.currentNpcId) return;
  closeDialogue();
  appendMsg('The conversation ends as you leave.', 'system');
}

// A stable per-row key: stock rows key on item_id, sellable rows on inventory_id.
function shopUid(it) {
  return it.inventory_id != null ? `v${it.inventory_id}` : `i${it.item_id}`;
}

// Max quantity for the stepper: on Sell, the held stack; on Buy, what the player
// can afford (non-stackable items cap at 1 — the server enforces this too).
function shopMaxQty(it, mode, credits) {
  if (mode === 'sell') return it.quantity || 1;
  if (it.stackable === false) return 1;
  if (!it.price) return 1;
  return Math.max(1, Math.min(99, Math.floor(credits / it.price)));
}

// Entry point: called on every `dialogue_shop` message (fresh open + post-buy/sell
// refresh). Tab, sort, and selection persist across the round-trip; quantity
// resets to 1 after any server refresh. All tab/sort/selection/stepper changes
// re-render locally from the same message — only buy/sell/back hit the server.
export function openShop(msg) {
  state.currentNpcId = msg.npcId;
  dialogueZone = state.currentZone;
  const mode = msg.sellResult ? 'sell' : msg.buyResult ? 'buy' : (shopState?.mode || 'buy');
  const sort = shopState?.sort || 'alpha';
  // A fresh entry (no buy/sell result) paints credits statically; a transaction
  // refresh keeps the prior baseline so the counter rolls to the new balance.
  if (!msg.buyResult && !msg.sellResult) lastShownCredits = null;
  shopState = { msg, mode, sort, sel: shopState?.sel ?? null, qty: 1 };
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-panel').classList.add('active', 'shop-mode');
  document.getElementById('dialogue-box').classList.add('shop-mode');
  renderShop();
}

function renderShop() {
  if (!shopState) return;
  const { msg, mode, sort } = shopState;
  const credits = msg.credits ?? 0;
  const list = sortItems(mode === 'sell' ? (msg.inventory || []) : (msg.stock || []), sort);

  // Drop a stale selection (e.g. the last of a stack was just sold).
  if (shopState.sel && !list.some(it => shopUid(it) === shopState.sel)) shopState.sel = null;
  const selItem = list.find(it => shopUid(it) === shopState.sel) || null;
  const maxQ = selItem ? shopMaxQty(selItem, mode, credits) : 1;
  shopState.qty = Math.max(1, Math.min(maxQ, shopState.qty));
  const qty = shopState.qty;

  const bar = `<div class="shop-bar">`
    + `<div class="shop-modes">`
    + `<button data-mode="buy" class="${mode === 'buy' ? 'on' : ''}">Buy</button>`
    + `<button data-mode="sell" class="${mode === 'sell' ? 'on' : ''}">Sell</button>`
    + `</div>`
    + `<div class="shop-bar-right">`
    + `<div class="shop-sort"><span>Sort</span>`
    + SORTS.map(s => `<button data-sort="${s.key}" class="${sort === s.key ? 'on' : ''}">${s.label}</button>`).join('')
    + `</div>`
    + `<div class="shop-cred">Credits <b>${credits}</b>₵</div>`
    + `</div></div>`;

  const rows = list.length ? list.map(it => {
    const uid = shopUid(it);
    const unaff = mode === 'buy' && it.price > credits;
    const qtyTxt = it.quantity > 1 ? ` ×${it.quantity}` : '';
    return `<div class="shop-row${shopState.sel === uid ? ' sel' : ''}" data-uid="${uid}">`
      + `<span class="nm">${it.name}${qtyTxt} <span class="wg">(${formatWeight(it.weight)})</span></span>`
      + `<span class="pr${unaff ? ' noafford' : ''}">${it.price}₵</span></div>`;
  }).join('') : `<div class="shop-empty">${mode === 'sell' ? 'Nothing to sell.' : 'Nothing in stock.'}</div>`;

  let card;
  if (!selItem) {
    card = `<div class="shop-card-empty">── no item selected ──<br><br>pick a line to open its record</div>`;
  } else {
    const stats = (selItem.stats || []).map(s =>
      `<div class="shop-statline"><span>${s.k}</span><b class="${s.c ? 'stat-' + s.c : ''}">${s.v}</b></div>`).join('');
    card = `<div class="shop-card-inner">`
      + `<div class="shop-card-name">${selItem.name}</div>`
      + `<div class="shop-card-cat">${selItem.category || ''}</div><hr>`
      + `<div class="shop-card-desc">${selItem.description || ''}</div>`
      + (stats ? `<div class="shop-stats">${stats}</div>` : '')
      + `<div class="shop-card-meta">`
      + `<span>unit ${mode === 'buy' ? 'price' : 'value'}</span><b>${selItem.price}₵</b>`
      + `<span>weight (each)</span><b>${formatWeight(selItem.weight)}</b>`
      + (mode === 'sell' ? `<span>in pack</span><b>${selItem.quantity}</b>` : '')
      + (mode === 'buy' && selItem.discounted ? `<span>rep discount</span><b class="stat-good">applied</b>` : '')
      + `</div>`
      + `<div class="shop-qtywrap"><div class="shop-qty">`
      + `<button data-step="-1" ${qty <= 1 ? 'disabled' : ''}>−</button><span>${qty}</span>`
      + `<button data-step="1" ${qty >= maxQ ? 'disabled' : ''}>+</button></div>`
      + `<button class="shop-max" ${maxQ <= 1 ? 'disabled' : ''}>Max ${maxQ}</button></div></div>`;
  }

  let foot = '';
  if (selItem) {
    const total = selItem.price * qty;
    const aff = mode === 'sell' || total <= credits;
    foot = `<div class="shop-total">${mode === 'buy' ? 'cost' : 'you receive'} <b>${total}₵</b>`
      + `${mode === 'buy' && !aff ? ' <span class="noafford">insufficient</span>' : ''}</div>`
      + `<button class="shop-exec" ${aff ? '' : 'disabled'}>${mode === 'buy' ? 'Purchase' : 'Sell'} ×${qty}</button>`;
  } else if (mode === 'sell' && list.length) {
    const totalQty = list.reduce((n, it) => n + (it.quantity || 1), 0);
    const totalValue = list.reduce((n, it) => n + (it.price || 0) * (it.quantity || 1), 0);
    foot = `<button class="shop-sellall">Sell all (${totalQty} item${totalQty === 1 ? '' : 's'}) — ${totalValue}₵</button>`;
  }

  // The vendor quip band always holds its spot (reserved min-height) so the panes
  // don't jump when a buy/sell reaction appears. Empty until a transaction lands.
  const resultText = mode === 'sell' ? msg.sellResult : msg.buyResult;
  const resultOk = mode === 'sell' ? msg.sellSuccess : msg.buySuccess;
  const resultBanner = `<div class="shop-result"${resultText ? ` style="color:${resultOk ? 'var(--green)' : 'var(--red)'}"` : ''}>${resultText || ''}</div>`;

  document.getElementById('dialogue-text').innerHTML =
    `<div class="shop2">${bar}${resultBanner}`
    + `<div class="shop-2pane"><div class="shop-list">${rows}</div><div class="shop-card">${card}</div></div>`
    + `<div class="shop-foot">${foot}</div></div>`;

  // Back + Leave share one row (the panel's static Leave button is hidden in
  // shop mode via CSS, so we render our own here to keep them on a single line).
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'dialogue-opt shop-back';
  backBtn.textContent = '← Back';
  backBtn.onclick = () => sendDialogue(msg.npcId, 'root');
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'dialogue-opt shop-leave';
  leaveBtn.textContent = '[ Leave ]';
  leaveBtn.onclick = closeDialogue;
  opts.append(backBtn, leaveBtn);

  animateCredits(credits);
  wireShopEvents();
}

function wireShopEvents() {
  const { msg, mode, sort } = shopState;
  const root = document.getElementById('dialogue-text');
  const currentList = () => sortItems(mode === 'sell' ? (msg.inventory || []) : (msg.stock || []), sort);
  const selected = () => currentList().find(it => shopUid(it) === shopState.sel);

  root.querySelectorAll('.shop-modes > button').forEach(b => b.onclick = () => {
    shopState.mode = b.dataset.mode; shopState.sel = null; shopState.qty = 1; renderShop();
  });
  root.querySelectorAll('.shop-sort button').forEach(b => b.onclick = () => {
    shopState.sort = b.dataset.sort; renderShop();
  });
  root.querySelectorAll('.shop-row').forEach(r => r.onclick = () => {
    shopState.sel = r.dataset.uid; shopState.qty = 1; renderShop();
  });
  root.querySelectorAll('.shop-qty button').forEach(b => b.onclick = () => {
    shopState.qty += Number(b.dataset.step); renderShop();
  });
  const maxBtn = root.querySelector('.shop-max');
  if (maxBtn) maxBtn.onclick = () => {
    const it = selected();
    if (it) { shopState.qty = shopMaxQty(it, mode, msg.credits ?? 0); renderShop(); }
  };
  const exec = root.querySelector('.shop-exec');
  if (exec) exec.onclick = () => {
    const it = selected();
    if (!it) return;
    if (mode === 'buy') buyFromNpc(msg.npcId, it.item_id, shopState.qty);
    else sellToNpc(msg.npcId, it.inventory_id, shopState.qty);
  };
  const sellAll = root.querySelector('.shop-sellall');
  if (sellAll) sellAll.onclick = () => sellAllToNpc(msg.npcId);
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
