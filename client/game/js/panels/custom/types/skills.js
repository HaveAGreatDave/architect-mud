import { esc } from '../catalogs.js';

// Compact whole-skill-list readout. Data arrives via panel_data (key 'skills')
// as { groups: [{ category, skills: [{ name, final }] }] }.
export function renderSkills(bodyEl, ctx) {
  const data = ctx.data && ctx.data.skills;
  if (!data || !data.groups) { bodyEl.innerHTML = '<div class="cpanel-empty">Loading skills…</div>'; return; }
  bodyEl.innerHTML = data.groups.map(g => {
    const rows = g.skills.map(s =>
      `<div class="cpanel-row"><span class="cpanel-row-label">${esc(s.name)}</span><span class="cpanel-row-val">${s.final}</span></div>`
    ).join('');
    return `<div class="cpanel-skill-group"><div class="cpanel-subhead">${esc(g.category.toUpperCase())}</div><div class="cpanel-rows">${rows}</div></div>`;
  }).join('');
}
