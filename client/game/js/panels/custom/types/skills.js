import { esc } from '../catalogs.js';

// Skill readout. Data arrives via panel_data (key 'skills') as
// { groups: [{ category, skills: [{ id, name, final }] }] }. config.skills, when
// non-empty, restricts the list to those skill ids; empty/absent shows all.
export function renderSkills(bodyEl, ctx) {
  const data = ctx.data && ctx.data.skills;
  if (!data || !data.groups) { bodyEl.innerHTML = '<div class="cpanel-empty">Loading skills…</div>'; return; }
  const wanted = ctx.config.skills;
  const filter = Array.isArray(wanted) && wanted.length ? new Set(wanted) : null;
  const html = data.groups.map(g => {
    const skills = filter ? g.skills.filter(s => filter.has(s.id)) : g.skills;
    if (!skills.length) return '';
    const rows = skills.map(s =>
      `<div class="cpanel-row"><span class="cpanel-row-label">${esc(s.name)}</span><span class="cpanel-row-val">${s.final}</span></div>`
    ).join('');
    return `<div class="cpanel-skill-group"><div class="cpanel-subhead">${esc(g.category.toUpperCase())}</div><div class="cpanel-rows">${rows}</div></div>`;
  }).join('');
  bodyEl.innerHTML = html || '<div class="cpanel-empty">No skills selected.</div>';
}
