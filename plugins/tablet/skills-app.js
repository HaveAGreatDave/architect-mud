// Tablet OS — Skills & Stats app. Pure re-shape of the existing `stats`/`skills`
// command payloads (server/engine/commands/world.js cmdStats/cmdSkills) into the
// two-pane layout. No new stat/skill math — same data the chat commands compute.
import { cmdStats, cmdSkills } from '../../server/engine/commands/world.js';
import { registerTabletApp, normScreen } from './registry.js';

// Fixed-size pages instead of one long list that keeps growing the panel —
// the panel chassis itself is now a fixed size (client/game/js/panels/
// tablet-os.js), but Skills specifically pages through its ~21 entries
// rather than relying on the inner scrollbar.
const SKILLS_PAGE_SIZE = 8;

async function buildScreen(player, screenId, params) {
  if (normScreen(screenId) === 'skills') {
    const skillsRes = await cmdSkills(player);
    if (skillsRes.type === 'error') return { view: 'error', message: skillsRes.message };
    const { groups } = skillsRes;
    const flat = groups.flatMap(g => g.skills.map(s => ({ ...s, category: g.category })));

    const raw = (params || '').trim();
    // "page:N" navigates pages; anything else is a skill name (detail view).
    if (raw && !raw.startsWith('page:')) {
      const skill = flat.find(s => normScreen(s.name) === normScreen(raw));
      if (!skill) return { view: 'error', message: 'Skill not found.' };
      return {
        view: 'detail',
        breadcrumb: ['Skills', skill.name],
        quest: null,
        detail: {
          name: skill.name, desc: skill.desc,
          rows: [
            { label: 'Category', value: skill.category },
            { label: 'Governing stats', value: skill.stats.join(' / ') },
            { label: 'IP invested', value: skill.ip },
            { label: 'Level', value: skill.level },
            { label: 'Stat bonus', value: skill.statBonus },
            { label: 'Effective', value: skill.final },
          ],
        },
        actions: [],
      };
    }

    const totalPages = Math.max(1, Math.ceil(flat.length / SKILLS_PAGE_SIZE));
    const requested = raw.startsWith('page:') ? parseInt(raw.slice(5), 10) || 0 : 0;
    const page = Math.min(Math.max(0, requested), totalPages - 1);
    const pageItems = flat.slice(page * SKILLS_PAGE_SIZE, page * SKILLS_PAGE_SIZE + SKILLS_PAGE_SIZE);
    return {
      view: 'list',
      breadcrumb: ['Skills'],
      items: pageItems.map(s => ({ id: s.name, label: s.name, sub: `${s.category} · lvl ${s.level} (${s.final} effective)` })),
      page: { current: page, total: totalPages },
    };
  }

  // Root: stats overview.
  const statsRes = await cmdStats(player);
  if (statsRes.type === 'error') return { view: 'error', message: statsRes.message };
  const { stats } = statsRes;
  return {
    view: 'detail',
    breadcrumb: [],
    detail: {
      name: stats.handle,
      desc: stats.archetype,
      rows: [
        { label: 'Brawn', value: stats.brawn }, { label: 'Reflexes', value: stats.reflexes },
        { label: 'Brains', value: stats.brains }, { label: 'Cool', value: stats.cool },
        { label: 'Endurance', value: stats.endurance }, { label: 'Senses', value: stats.senses },
        { label: 'Carry capacity', value: stats.carry },
        { label: 'Net XP', value: stats.net_xp }, { label: 'Total XP', value: stats.total_xp },
        { label: 'Status', value: stats.status.join(', ') || 'Normal' },
      ],
    },
    actions: [{ id: 'nav_skills', label: 'View Skills' }],
  };
}

async function handleAction(player, actionId) {
  if (actionId === 'nav_skills') return buildScreen(player, 'Skills', '');
  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'skills', name: 'Skills & Stats', icon: '💪', category: 'Progression',
  buildScreen, handleAction,
});
