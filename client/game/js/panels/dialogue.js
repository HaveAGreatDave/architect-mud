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

// ── Conversation presentation ────────────────────────────────────────────────
// Three things make the panel read as an interaction rather than a dialog box:
// the speaker's line is TYPED rather than pasted, the options only appear once
// they've finished speaking, and the NPC takes a beat to think before answering.
// All three are timing, not decoration — see the notes on each below.

// Conversation SFX sit under speech and ambience; these fire constantly so they
// have to be felt more than heard.
const DIALOGUE_SFX_GAIN = 0.5;
function dsfx(cue) {
  const def = window.SFXCatalog?.get('dialogue-' + cue);
  if (def) window.AudioEngine?.playSfx(def, DIALOGUE_SFX_GAIN);
}

// Typewriter: characters per second, but capped in total so a long speech doesn't
// hold the player hostage — the rate scales up instead of the wait growing.
const TYPE_CPS = 90;
const TYPE_MAX_MS = 2200;
let typeRaf = null;      // in-flight reveal (cancelled on skip / next node)
let typeFinish = null;   // completes the current reveal immediately

// The NPC "thinks" before replying. Server round-trip latency counts toward this,
// so on a fast local connection this is the whole beat and on a slow one it costs
// nothing extra — the reply just never lands *instantly*, which is what made the
// old panel feel like a form submit.
const THINK_MS = 160;
let thinkingUntil = 0;
let thinkTimer = null;

// Reveal `#dialogue-text` a character at a time. Works over the node's HTML (the
// server sends spans — item grants, coloured names), so it walks the text nodes
// and refills them progressively instead of retyping a string; markup therefore
// never flashes half-written. `onDone` runs on natural completion AND on skip.
function typeOut(el, onDone) {
  cancelType();
  const nodes = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push({ node: n, full: n.nodeValue });
  const total = nodes.reduce((n, t) => n + t.full.length, 0);
  for (const t of nodes) t.node.nodeValue = '';
  if (!total) { onDone?.(); return; }

  const durMs = Math.min(TYPE_MAX_MS, (total / TYPE_CPS) * 1000);
  const start = performance.now();
  const finish = () => {
    cancelType();
    for (const t of nodes) t.node.nodeValue = t.full;
    onDone?.();
  };
  typeFinish = finish;
  const step = (now) => {
    const shown = Math.round(total * Math.min(1, (now - start) / durMs));
    let left = shown;
    for (const t of nodes) {
      const take = Math.max(0, Math.min(t.full.length, left));
      if (t.node.nodeValue.length !== take) t.node.nodeValue = t.full.slice(0, take);
      left -= take;
    }
    if (shown >= total) finish();
    else typeRaf = requestAnimationFrame(step);
  };
  typeRaf = requestAnimationFrame(step);
}

function cancelType() {
  if (typeRaf) cancelAnimationFrame(typeRaf);
  typeRaf = null;
  typeFinish = null;
}

// Click or key while a line is still typing lands the rest of it at once, so the
// reveal is never a tax on a player who reads faster than 90cps.
export function skipDialogueTyping() {
  if (typeFinish) { typeFinish(); return true; }
  return false;
}

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

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Server-tagged option destinations (`_kind`, set in server/engine/dialogue.js) →
// the glyph that says where the option goes before you click it.
const OPT_KIND_ICON = {
  hostile: { icon: '⚠', title: 'This one turns violent' },
  shop:   { icon: '🛒', title: 'Opens their shop' },
  quest:  { icon: '❗', title: 'Takes on a job' },
  turnin: { icon: '✅', title: 'Hands in a job' },
  leave:  { icon: '🚪', title: 'Ends the conversation' },
};

function optionIconHtml(opt) {
  // A locked turn-in already wears a padlock (.dialogue-opt-locked::before) — one
  // status glyph per option, so don't stack ✅ on top of 🔒.
  if (opt._turninDisabled) return '';
  const k = OPT_KIND_ICON[opt._kind];
  // An author-assigned glyph (`icon`, set in the VINE play view) wins over the
  // derived one. A hostile option keeps its red styling and its stakes line
  // regardless — the warning is the colour and the hint, not the glyph.
  const icon = opt.icon || k?.icon;
  if (!icon) return '';
  const title = opt.icon ? (k?.title || '') : k.title;
  return `<span class="dialogue-opt-icon"${title ? ` title="${escHtml(title)}"` : ''}>${escHtml(icon)}</span>`;
}

// A reply is held until the NPC's thinking beat has elapsed (see THINK_MS). The
// wait is measured from the click, so server latency is spent inside it.
export function openDialogue(msg) {
  if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
  const wait = Math.max(0, thinkingUntil - performance.now());
  if (wait > 0) {
    thinkTimer = setTimeout(() => { thinkTimer = null; renderDialogue(msg); }, wait);
    return;
  }
  renderDialogue(msg);
}

function renderDialogue(msg) {
  const panel = document.getElementById('dialogue-panel');
  const box = document.getElementById('dialogue-box');
  const fresh = !panel.classList.contains('active');
  state.currentNpcId = msg.npcId;
  dialogueZone = state.currentZone;
  shopState = null;
  panel.classList.remove('shop-mode', 'closing');
  box.classList.remove('shop-mode');
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  // Mood only arrives on the moments it can have changed (arrival, and any line
  // that moved reputation) — so keep the last one through the middle of a tree,
  // and clear it when a NEW conversation opens without one.
  if (msg.mood) box.dataset.mood = msg.mood;
  else if (fresh) delete box.dataset.mood;

  const stageEl = document.getElementById('dialogue-stage');
  stageEl.textContent = msg.stage || '';
  stageEl.classList.toggle('on', !!msg.stage);
  const hintEl = document.getElementById('dialogue-hint');
  hintEl.textContent = '';
  hintEl.classList.remove('danger');

  const textEl = document.getElementById('dialogue-text');
  textEl.innerHTML = msg.text;
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  // Options are built now but stay veiled (CSS: faded, not clickable) until the
  // speaker has finished — the eye can't jump to the buttons mid-sentence.
  opts.classList.add('veiled');
  stageEl.classList.add('veiled');
  panel.classList.add('active');
  dsfx(fresh ? 'open' : 'line');
  typeOut(textEl, () => {
    opts.classList.remove('veiled');
    stageEl.classList.remove('veiled');
  });
  for (let i = 0; i < (msg.options || []).length; i++) {
    const opt = msg.options[i];
    if (!opt.next && !opt.cmd) continue;
    const rawLabel = opt.text || opt.label || '';
    const { label, gated } = formatOptionLabel(rawLabel);
    const btn = document.createElement('button');
    btn.className = 'dialogue-opt';
    // The server tags an option that starts violence / gets you charged / burns
    // standing; it gets red edging and its own stakes line, so an irreversible
    // choice never looks like every other choice.
    if (opt._kind === 'hostile') btn.classList.add('dialogue-opt-hostile');
    // Stakes footer: hover or keyboard-focus an option and the band under the
    // speech says where it goes, before the click.
    if (opt._hint) bindHint(btn, opt._hint, opt._kind === 'hostile');
    const branch = gated ? '<span class="dialogue-opt-branch">↳</span>' : '';
    const icon = optionIconHtml(opt);
    if (branch || icon) {
      btn.innerHTML = `${branch}${icon}${escHtml(label)}`;
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
    btn.onclick = opt.cmd
      ? () => { dsfx('opt'); closeDialogue(); sendCmd(opt.cmd, label); }
      : () => { dsfx('opt'); beginThinking(); sendDialogue(state.currentNpcId, opt.next, i); };
    opts.appendChild(btn);
  }
}

// Start the NPC's thinking beat and show it: the speech goes to an ellipsis so the
// panel visibly waits on them, rather than sitting on the line they already said.
function beginThinking() {
  cancelType();
  thinkingUntil = performance.now() + THINK_MS;
  const textEl = document.getElementById('dialogue-text');
  textEl.innerHTML = '<span class="dialogue-thinking">…</span>';
  document.getElementById('dialogue-options').classList.add('veiled');
  const hintEl = document.getElementById('dialogue-hint');
  hintEl.textContent = '';
  hintEl.classList.remove('danger');
}

function bindHint(btn, hint, danger) {
  const set = (t) => {
    const el = document.getElementById('dialogue-hint');
    el.textContent = t;
    el.classList.toggle('danger', !!t && !!danger);
  };
  btn.addEventListener('mouseenter', () => set(hint));
  btn.addEventListener('focus', () => set(hint));
  btn.addEventListener('mouseleave', () => set(''));
  btn.addEventListener('blur', () => set(''));
}

export function closeDialogue() {
  cancelType();
  if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
  thinkingUntil = 0;
  const panel = document.getElementById('dialogue-panel');
  // Exit animation: the box eases out on `.closing`, then the panel goes away.
  // Everything else tears down now, so a re-open mid-animation is still correct.
  if (panel.classList.contains('active')) {
    dsfx('close');
    panel.classList.add('closing');
    setTimeout(() => {
      if (panel.classList.contains('closing')) panel.classList.remove('active', 'closing', 'shop-mode');
    }, 150);
  }
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
  // The shop is a dense terminal, not a conversation: no typewriter, no veil, no
  // stage direction. Clear anything the dialogue side left behind.
  cancelType();
  document.getElementById('dialogue-options').classList.remove('veiled');
  document.getElementById('dialogue-stage').classList.remove('on', 'veiled');
  document.getElementById('dialogue-hint').textContent = '';
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-panel').classList.remove('closing');
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
    if (e.target === document.getElementById('dialogue-panel')) { closeDialogue(); return; }
    // Click anywhere in the speech while it's typing = land the rest now.
    if (e.target.closest('#dialogue-text')) skipDialogueTyping();
  });
  // Keyboard: Escape leaves, anything else lands a line that's still typing. Never
  // swallows the key — the command bar keeps working with a conversation open.
  document.addEventListener('keydown', (e) => {
    const panel = document.getElementById('dialogue-panel');
    if (!panel.classList.contains('active') || panel.classList.contains('shop-mode')) return;
    if (e.key === 'Escape') closeDialogue();
    else skipDialogueTyping();
  });
  document.querySelectorAll('#dialogue-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Leave')) btn.addEventListener('click', closeDialogue);
  });
}
