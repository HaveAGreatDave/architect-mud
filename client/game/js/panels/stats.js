import { sendCmdSilent } from '../net.js';

const RAISABLE = [
  { key: 'brawn', label: 'BRAWN', desc: 'Raises carrying capacity' },
  { key: 'reflexes', label: 'REFL', desc: 'Raises dodge' },
  { key: 'brains', label: 'BRNS', desc: 'Raises IP gain rate' },
  { key: 'cool', label: 'COOL', desc: 'Raises sell prices' },
  { key: 'endurance', label: 'END', desc: 'Raises HP' },
];

export function initStatsPanel() {
  document.getElementById('stats-close').addEventListener('click', closeStatsPanel);
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
  statSec.className = 'stats-section';
  const note = document.createElement('div');
  note.className = 'stats-note';
  note.innerHTML = `Spend XP to raise a stat — <b>${cost} XP</b> per point. You have <b>${s.net_xp}</b> XP.`;
  statSec.appendChild(note);

  for (const stat of RAISABLE) {
    const block = document.createElement('div');
    block.className = 'stats-stat-block';
    const row = document.createElement('div');
    row.className = 'stats-row';
    row.innerHTML = `<span class="stats-label">${stat.label}</span><span class="stats-val">${s[stat.key]}</span>`;
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
    flags.textContent = s.status.join(' · ');
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
      row.className = 'stats-row stats-skill';
      row.innerHTML =
        `<span class="stats-skill-name">${sk.name}</span>` +
        `<span class="stats-skill-gov">${sk.stats.join('/')}</span>` +
        `<span class="stats-val">${sk.level}</span>`;
      skillSec.appendChild(row);
    }
  }
  right.appendChild(skillSec);
}
