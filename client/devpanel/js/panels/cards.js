// CARDS PANEL — the authoring surface for trading cards.
//
// The character counters are the point of this panel: the card system's central
// claim is that no region ever truncates, and an author needs to see 331/340
// while they type rather than when a player pulls a broken card out of a machine.
//
// This edits CARDS, not subjects. An NPC's flavour overrides (flags.card_quote,
// card_note, card_rarity) live on the NPC row and are edited in the NPCs panel.

const CARD_RANK_COLOR = {
  common: 'var(--text-dim)', uncommon: 'var(--green)', rare: 'var(--cyan)',
  epic: 'var(--purple)', legendary: 'var(--orange)', architect: 'var(--yellow)',
};
let _cardBudgets = { handle: 16, epithet: 28, lastSeen: 340, origin: 150, quote: 90 };
let _cardRanks = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'architect'];

function cardRankBadge(r) {
  return `<span style="color:${CARD_RANK_COLOR[r] || 'var(--text-dim)'};font-size:11px;letter-spacing:.1em">${String(r || '').toUpperCase()}</span>`;
}

// SORTING IS CARD-LOCAL, and rarity is the whole reason. The generic comparator
// in core/table.js sorts strings alphabetically, which puts architect above
// common and epic above legendary — the exact opposite of the only order an
// author cares about. Rarity is a LADDER, so it sorts by its rung. Everything
// else falls through to the ordinary numeric/locale rules, and № sorts by the
// series-then-serial the column actually prints rather than by serial alone,
// which would interleave two series into nonsense.
const CARD_SORT_KEYS = new Set(['serial', 'subject_name', 'subject_type', 'rarity', 'power', 'pool_weight', 'held']);

function _cardSortValue(c, key) {
  switch (key) {
    case 'rarity': return _cardRanks.indexOf(c.rarity);
    case 'serial': return `${String(c.series ?? '').padStart(6, '0')}${String(c.serial ?? '').padStart(8, '0')}`;
    case 'power': case 'pool_weight': case 'held': return Number(c[key]) || 0;
    default: return c[key] ?? '';
  }
}

function _sortCards(records) {
  // sortState is shared across every panel, so a key left behind by the NPCs
  // table must not silently reorder this one. Unknown key ⇒ struck order.
  if (!sortState.key || !CARD_SORT_KEYS.has(sortState.key)) return records;
  return [...records].sort((a, b) => {
    const av = _cardSortValue(a, sortState.key);
    const bv = _cardSortValue(b, sortState.key);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
    return String(av).localeCompare(String(bv)) * sortState.dir;
  });
}

function _cardTh(key, label, right) {
  const isSorted = sortState.key === key;
  const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
  return `<th class="sortable-col${isSorted ? ' sorted' : ''}"${right ? ' style="text-align:right"' : ''} onclick="sortTableBy('${key}')">${label}${arrow}</th>`;
}

// Search re-renders the CARD table rather than falling through to the generic
// one in core/table.js — that fallback (`filterTable`, for panels with no filter
// hook) renders from `PANELS.cards.columns`, which is five columns with no №, no
// Held and an Edit button, so typing a letter swapped the table out for a
// different-shaped one and lost the sort you had just set.
let _cardQuery = '';
function filterCards(q) {
  _cardQuery = (q || '').toLowerCase();
  PANELS.cards.render();
}

function _queriedCards(records) {
  if (!_cardQuery) return records;
  return records.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(_cardQuery)));
}

function renderCardsTable(allCards) {
  const records = _queriedCards(allCards || []);
  if (!records?.length && _cardQuery) {
    return `<div class="empty-state">No card matches “${_cardQuery}”.</div>`;
  }
  if (!records?.length) {
    return `<div class="empty-state">No cards struck yet.
      <p style="color:var(--text-dim);margin-top:8px">Use <b>Strike series</b> below to cut a card for every eligible NPC and enemy in world content — that's what fills the pack pool on day one. Player cards arrive as players mint themselves.</p>
      ${cardToolbar()}</div>`;
  }
  const spread = _raritySpread(records);

  // The count/spread line and the strike buttons pin as one block; the column
  // headers are sticky already (core styles) and park directly beneath it, so a
  // scroll down a four-hundred-card series never loses which column is which.
  return `
    <div class="panel-sticky-head" style="padding:12px 12px 2px">
      <div style="margin-bottom:12px;color:var(--text-dim);font-size:13px">${records.length} cards &nbsp;—&nbsp; ${spread}</div>
      ${cardToolbar()}
    </div>
    ${_cardGroups(records).map(g => _cardSection(g)).join('')}`;
}

function _raritySpread(records) {
  const counts = records.reduce((a, c) => { a[c.rarity] = (a[c.rarity] || 0) + 1; return a; }, {});
  return _cardRanks.filter(r => counts[r]).map(r => `${cardRankBadge(r)} <b>${counts[r]}</b>`).join(' &nbsp;·&nbsp; ');
}

// The three subject types are three different jobs, not three values of a field:
// NPC and enemy cards are STRUCK from world content in bulk, player cards arrive
// one at a time as players mint themselves. Grouping lets you collapse the two
// bulk piles and actually see the handful of player cards, which are otherwise
// four rows lost in four hundred. Authored order, not alphabetical — an unknown
// subject_type still gets its own section rather than being dropped.
const CARD_GROUPS = [
  { type: 'npc', label: 'NPCs' },
  { type: 'enemy', label: 'Enemies' },
  { type: 'player', label: 'Players' },
];

function _cardGroups(records) {
  const byType = new Map();
  for (const c of records) {
    const t = c.subject_type || '(none)';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(c);
  }
  const known = CARD_GROUPS
    .filter(g => byType.has(g.type))
    .map(g => ({ ...g, cards: byType.get(g.type) }));
  const rest = [...byType.keys()]
    .filter(t => !CARD_GROUPS.some(g => g.type === t))
    .sort((a, b) => a.localeCompare(b))
    .map(t => ({ type: t, label: t, cards: byType.get(t) }));
  return [...known, ...rest];
}

// Collapse state is per subject type and survives a re-render, so sorting or
// searching doesn't silently re-open the piles you just shut.
const collapsedCardTypes = new Set();
function toggleCardTypeCollapse(type) {
  if (collapsedCardTypes.has(type)) collapsedCardTypes.delete(type);
  else collapsedCardTypes.add(type);
  PANELS.cards.render();
}

function _cardSection({ type, label, cards }) {
  const collapsed = collapsedCardTypes.has(type);
  const typeSafe = String(type).replace(/'/g, "\\'");
  const head = `<div class="item-type-hdr card-group-hdr" onclick="toggleCardTypeCollapse('${typeSafe}')">
      <span class="item-type-hdr-arrow">${collapsed ? '▶' : '▼'}</span>
      <span class="item-type-hdr-label">${label}</span>
      <span style="font-size:11px">${_raritySpread(cards)}</span>
      <span class="item-type-hdr-count">${cards.length}</span>
    </div>`;
  if (collapsed) return `<div class="item-section">${head}</div>`;
  // Each section carries its own header row — they're separate tables, so a
  // shared one is impossible — but they all read the same sortState, so clicking
  // any column sorts every group by it at once.
  const rows = _sortCards(cards).map(c => `
    <tr onclick="editRecord('${c.id}')" style="cursor:pointer">
      <td style="font-variant-numeric:tabular-nums">${c.series}·${String(c.serial).padStart(4, '0')}</td>
      <td>${c.subject_name}</td>
      <td><span class="badge">${c.subject_type}</span></td>
      <td>${cardRankBadge(c.rarity)}</td>
      <td style="text-align:right">${c.power}</td>
      <td style="text-align:right;color:${Number(c.pool_weight) > 0 ? 'var(--text)' : 'var(--red)'}">${Number(c.pool_weight) > 0 ? c.pool_weight : 'never packs'}</td>
      <td style="text-align:right;color:var(--text-dim)">${c.held || 0}</td>
    </tr>`).join('');
  return `<div class="item-section">${head}
    <table class="data-table">
      <thead><tr>
        ${_cardTh('serial', '№')}${_cardTh('subject_name', 'Subject')}${_cardTh('subject_type', 'Type')}${_cardTh('rarity', 'Rarity')}
        ${_cardTh('power', 'Power', true)}${_cardTh('pool_weight', 'Pool', true)}${_cardTh('held', 'Held', true)}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function cardToolbar() {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <button class="btn" onclick="cardStrikeSeries()">⚒ Strike series</button>
    <button class="btn" onclick="cardIssueArchitect()">✦ Issue Architect card</button>
  </div>`;
}

async function cardStrikeSeries() {
  const series = parseInt(prompt('Strike NPC + enemy cards for which series?', '1'), 10);
  if (!Number.isFinite(series)) return;
  const r = await API('/cards/strike', 'POST', { series });
  if (r?.error) return alert(r.error);
  alert(`Struck ${r.struck} new card${r.struck === 1 ? '' : 's'}. Already-carded subjects were skipped, so this is safe to re-run after adding content.`);
  showPanel('cards');
}

async function cardIssueArchitect() {
  const handle = prompt('Issue an Architect card to which player handle?');
  if (!handle) return;
  const r = await API('/cards/architect', 'POST', {
    handle,
    epithet: prompt('Epithet (max 28 chars)', 'Architect issue') || 'Architect issue',
    lastSeen: prompt('Last seen (max 340)') || '',
    origin: prompt('In their own words (max 150)') || '',
    quote: prompt('Overheard (max 90)') || '',
  });
  if (r?.error) return alert(r.error);
  alert(`Issued № ${String(r.serial).padStart(4, '0')}. Pool weight 0 — it can never come out of a machine, only be traded.`);
  showPanel('cards');
}

// Live character counter. Over budget is a hard stop, not a warning: the fix is
// always to cut a whole clause, never to trim one.
function cardCounter(id, cap) {
  const el = document.getElementById(id);
  const out = document.getElementById(id + '-count');
  if (!el || !out) return;
  const n = el.value.length;
  out.textContent = `${n}/${cap}`;
  out.style.color = n > cap ? 'var(--red)' : n > cap * 0.9 ? 'var(--orange)' : 'var(--text-dim)';
}

function cardEditForm(c) {
  const B = _cardBudgets;
  const t = c.text_blocks || {};
  const field = (key, label, cap, rows) => `
    <div class="form-group">
      <label>${label} <span id="card-${key}-count" style="float:right;font-variant-numeric:tabular-nums;color:var(--text-dim)">${(t[key] || '').length}/${cap}</span></label>
      <textarea id="card-${key}" rows="${rows}" oninput="cardCounter('card-${key}', ${cap})">${(t[key] || '').replace(/</g, '&lt;')}</textarea>
    </div>`;

  return `
    <div class="form-group">
      <label>Subject</label>
      <div style="padding:8px 0"><b>${c.subject_name}</b> <span class="badge">${c.subject_type}</span>
        <span style="color:var(--text-dim)">· series ${c.series} № ${String(c.serial).padStart(4, '0')} · power ${c.power}</span></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Rarity <span style="color:var(--text-dim)">(stored, never recomputed)</span></label>
        <select id="card-rarity">${_cardRanks.map(r => `<option value="${r}"${r === c.rarity ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label>Pool weight <span style="color:var(--text-dim)">(0 = never in a pack)</span></label>
        <input type="number" step="0.1" id="card-pool" value="${c.pool_weight}">
      </div>
    </div>
    ${field('epithet', 'Epithet', B.epithet, 1)}
    ${field('last_seen', c.subject_type === 'enemy' ? 'In the field' : 'Last seen', B.lastSeen, 5)}
    ${field('origin', c.subject_type === 'enemy' ? 'What it leaves' : 'In their own words', B.origin, 3)}
    ${field('quote', 'Overheard', B.quote, 2)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      ${c.subject_type !== 'player'
        ? `<button class="btn" onclick="cardRederive('${c.id}')">↻ Re-derive from ${c.subject_type} row</button>`
        : `<span style="color:var(--text-dim);font-size:12px;align-self:center">A player card is a frozen moment — it has no live source to re-derive from.</span>`}
    </div>
    <div style="margin-top:12px;padding:10px;border:1px solid var(--border);background:var(--bg3)">
      <div style="font-size:11px;letter-spacing:.14em;color:var(--text-dim);text-transform:uppercase;margin-bottom:8px">Preview</div>
      <div id="card-preview">${cardPreview(c)}</div>
    </div>`;
}

function cardPreview(c) {
  const t = c.text_blocks || {};
  const col = CARD_RANK_COLOR[c.rarity] || 'var(--text-dim)';
  return `<div style="border:1px solid ${col};padding:12px;max-width:420px;font-size:13px;line-height:1.5;background:#07070d">
    <div style="font-size:10px;letter-spacing:.16em;color:var(--text-dim);text-transform:uppercase">Series ${c.series} · № ${String(c.serial).padStart(4, '0')}</div>
    <div style="font-size:22px;font-weight:700;letter-spacing:.05em;margin:4px 0 2px">${c.subject_name}</div>
    <div style="font-size:11px;letter-spacing:.1em;color:var(--text-dim);text-transform:uppercase">${t.epithet || c.subject_type} · ${cardRankBadge(c.rarity)}</div>
    ${t.last_seen ? `<div style="margin-top:10px">${t.last_seen}</div>` : ''}
    ${t.origin ? `<div style="margin-top:8px;font-style:italic;border-left:2px solid ${col};padding-left:9px">“${t.origin}”</div>` : ''}
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);color:var(--yellow)">“${t.quote || ''}”</div>
  </div>`;
}

async function cardRederive(id) {
  const r = await API(`/cards/${id}/rederive`, 'POST', {});
  if (r?.error) return alert(r.error);
  alert('Re-derived from the source row.');
  showPanel('cards');
}

async function saveCard(id) {
  const body = {
    rarity: document.getElementById('card-rarity').value,
    pool_weight: parseFloat(document.getElementById('card-pool').value),
    text_blocks: {
      epithet: document.getElementById('card-epithet').value,
      last_seen: document.getElementById('card-last_seen').value,
      origin: document.getElementById('card-origin').value,
      quote: document.getElementById('card-quote').value,
    },
  };
  const r = await API(`/cards/${id}`, 'PUT', body);
  if (r?.error) { alert(r.error); return false; }
  return true;
}
