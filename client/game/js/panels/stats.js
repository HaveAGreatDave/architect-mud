import { sendCmdSilent } from '../net.js';
import { registerList, mountScopeToggle } from './list-reorder.js';

const RAISABLE = [
  { key: 'brawn', label: 'BRAWN', desc: 'Raises carrying capacity' },
  { key: 'reflexes', label: 'REFL', desc: 'Raises dodge' },
  { key: 'brains', label: 'BRNS', desc: 'Raises IP gain rate' },
  { key: 'cool', label: 'COOL', desc: 'Raises sell prices' },
  { key: 'endurance', label: 'END', desc: 'Raises HP' },
  { key: 'senses', label: 'SEN', desc: 'Raises dodge; spots hidden things' },
];

export function initStatsPanel() {
  document.getElementById('stats-close').addEventListener('click', closeStatsPanel);
  mountScopeToggle('stats', document.getElementById('stats-header'));
}

export function closeStatsPanel() {
  document.getElementById('stats-panel').classList.remove('active');
}

function accountAge(createdAt) {
  if (!createdAt) return 'unknown';
  const days = Math.floor((Date.now() / 1000 - createdAt) / 86400);
  if (days <= 0) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  const years = Math.floor(days / 365);
  const months = Math.floor((days - years * 365) / 30);
  return months ? `${years}y ${months}mo` : `${years} year${years === 1 ? '' : 's'}`;
}

export function renderStatsPanel(s) {
  const body = document.getElementById('stats-body');
  body.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'stats-title';
  title.innerHTML = `<span class="stats-handle">${s.handle}</span> — ${s.archetype}`;
  body.appendChild(title);

  const cols = document.createElement('div');
  cols.className = 'stats-cols';
  const left = document.createElement('div');
  left.className = 'stats-col stats-col-left';
  const right = document.createElement('div');
  right.className = 'stats-col stats-col-right';
  cols.append(left, right);
  body.appendChild(cols);

  // LEFT — core stats (each raisable from here), then resources.
  const cost = s.stat_cost;
  const statSec = document.createElement('div');
  // `stats-core` is the hook the tile grid styles against. The six stats are the
  // one part of this sheet that is a CHARACTER rather than a table of numbers,
  // and rendering them as six more label/value rows made the whole panel read as
  // a receipt. Drag-reorder still works — registerList keys off the blocks, and a
  // grid reorders exactly as a stack does.
  statSec.className = 'stats-section stats-core';
  const note = document.createElement('div');
  note.className = 'stats-note';
  note.innerHTML = `Spend XP to raise a stat — <b>${cost} XP</b> per point. You have <b>${s.net_xp}</b> XP.`;
  statSec.appendChild(note);

  for (const stat of RAISABLE) {
    const block = document.createElement('div');
    block.className = 'stats-stat-block';
    block.dataset.lrKey = stat.key;
    // A never-raised stat (0 — see raiseStat: current = p[col] || 0) reads as
    // blank rather than a literal "0", so a freshly-made character's sheet
    // doesn't show six zeroes before they've grown into anything.
    const statVal = s[stat.key] ? s[stat.key] : '—';
    const row = document.createElement('div');
    row.className = 'stats-row';
    row.innerHTML = `<span class="stats-label">${stat.label}</span><span class="stats-val">${statVal}</span>`;
    const btn = document.createElement('button');
    btn.className = 'stats-raise-btn';
    btn.textContent = '+';
    btn.disabled = s.net_xp < cost;
    btn.title = s.net_xp < cost ? `Need ${cost} XP` : `Raise ${stat.label} (${cost} XP)`;
    btn.onclick = () => { sendCmdSilent('raise ' + stat.key); sendCmdSilent('stats'); };
    row.appendChild(btn);
    block.appendChild(row);
    const desc = document.createElement('div');
    desc.className = 'stats-desc';
    desc.textContent = stat.desc;
    block.appendChild(desc);
    statSec.appendChild(block);
  }
  registerList(statSec, { scope: 'stats', key: 'stats-core', rowSelector: '.stats-stat-block' });
  left.appendChild(statSec);

  const resSec = document.createElement('div');
  resSec.className = 'stats-section';
  resSec.innerHTML =
    `<div class="stats-row"><span class="stats-label">Carry</span><span class="stats-val">${s.carry} max</span></div>` +
    `<div class="stats-row"><span class="stats-label">XP</span><span class="stats-val">${s.net_xp} (Total: ${s.total_xp})</span></div>` +
    `<div class="stats-row"><span class="stats-label">Credits</span><span class="stats-val">${s.credits}</span></div>` +
    `<div class="stats-row"><span class="stats-label">Account age</span><span class="stats-val">${accountAge(s.created_at)}</span></div>`;
  left.appendChild(resSec);

  if (s.status && s.status.length) {
    const flags = document.createElement('div');
    flags.className = 'status-flags';
    // One chip per condition rather than a single ' · '-joined run. These lines
    // are things like "REF −2 (soaked)" — a sentence each, and strung together
    // they wrapped mid-clause into an unreadable ribbon. A chip can't wrap
    // through its own parentheses. textContent per chip, never innerHTML: these
    // strings are built from condition labels, not authored markup.
    for (const f of s.status) {
      const chip = document.createElement('span');
      chip.className = 'status-chip';
      chip.textContent = f;
      flags.appendChild(chip);
    }
    left.appendChild(flags);
  }

  // RIGHT — skills (base levels only) with governing stats.
  const skillSec = document.createElement('div');
  skillSec.className = 'stats-section';
  for (const group of s.skills) {
    const cat = document.createElement('div');
    cat.className = 'stats-cat';
    cat.textContent = group.category.toUpperCase();
    skillSec.appendChild(cat);
    for (const sk of group.skills) {
      const row = document.createElement('div');
      // An unlearned skill recedes rather than printing a bright 0. The list runs
      // to dozens of rows and on a new character almost all of them are zero —
      // every one of those competing for attention with the two you actually have
      // is what made this a wall of text instead of a sheet.
      row.className = `stats-row stats-skill${sk.level ? '' : ' stats-skill-none'}`;
      row.innerHTML =
        `<span class="stats-skill-name">${sk.name}</span>` +
        `<span class="stats-skill-gov">${sk.stats.join('/')}</span>` +
        `<span class="stats-val">${sk.level || '—'}</span>`;
      skillSec.appendChild(row);
    }
  }
  right.appendChild(skillSec);
}
