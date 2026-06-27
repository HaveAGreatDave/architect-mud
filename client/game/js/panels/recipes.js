import { sendCmdSilent } from '../net.js';

const PER_PAGE = 5;
let lastRecipes = [];
let activeSkill = null;
let page = 0;

export function initRecipesPanel() {
  document.getElementById('recipes-close').addEventListener('click', closeRecipesPanel);
}

export function closeRecipesPanel() {
  document.getElementById('recipes-panel').classList.remove('active');
}

function skillLabel(skillId) {
  return skillId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function renderRecipesPanel(recipes) {
  lastRecipes = recipes;
  const skills = [...new Set(recipes.map(r => r.skill_id))];

  if (!skills.includes(activeSkill)) { activeSkill = skills[0] || null; page = 0; }

  // Tabs
  const tabs = document.getElementById('recipes-tabs');
  tabs.innerHTML = '';
  for (const skillId of skills) {
    const btn = document.createElement('button');
    btn.className = 'recipe-tab' + (skillId === activeSkill ? ' active' : '');
    btn.textContent = skillLabel(skillId);
    btn.onclick = () => { activeSkill = skillId; page = 0; renderRecipesPanel(lastRecipes); };
    tabs.appendChild(btn);
  }

  const list = document.getElementById('recipes-list');
  list.innerHTML = '';
  if (!activeSkill) {
    list.innerHTML = '<div class="recipes-empty">You don\'t know any recipes yet.</div>';
    document.getElementById('recipes-pager').innerHTML = '';
    return;
  }

  const filtered = lastRecipes.filter(r => r.skill_id === activeSkill);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (page >= pageCount) page = pageCount - 1;
  const shown = filtered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  for (const r of shown) {
    const card = document.createElement('div');
    card.className = 'recipe-card';

    const ingredients = r.ingredients.map(ing =>
      `<span class="recipe-ing ${ing.have >= ing.need ? 'ok' : 'missing'}">${ing.name} ${ing.have}/${ing.need}</span>`
    ).join('');

    const station = r.station ? `<div class="recipe-station">Requires: ${r.station.replace(/_/g, ' ')}</div>` : '';

    card.innerHTML =
      `<div class="recipe-name">${r.name}</div>` +
      `<div class="recipe-desc">${r.description || ''}</div>` +
      `<div class="recipe-output">Yields: ${r.output.quantity}× ${r.output.name}</div>` +
      station +
      `<div class="recipe-ings">${ingredients || '<span class="recipe-ing">no materials</span>'}</div>`;

    const btn = document.createElement('button');
    btn.className = 'recipe-craft-btn';
    btn.textContent = 'Craft';
    btn.disabled = !r.craftable;
    if (!r.craftable && r.reason) btn.title = r.reason;
    btn.onclick = () => sendCmdSilent('craft ' + r.name);
    card.appendChild(btn);

    list.appendChild(card);
  }

  // Pager
  const pager = document.getElementById('recipes-pager');
  if (pageCount <= 1) {
    pager.innerHTML = '';
  } else {
    pager.innerHTML = '';
    const prev = document.createElement('button');
    prev.className = 'recipe-page-btn';
    prev.textContent = '‹ Prev';
    prev.disabled = page === 0;
    prev.onclick = () => { page--; renderRecipesPanel(lastRecipes); };
    const label = document.createElement('span');
    label.className = 'recipe-page-label';
    label.textContent = `Page ${page + 1} of ${pageCount}`;
    const next = document.createElement('button');
    next.className = 'recipe-page-btn';
    next.textContent = 'Next ›';
    next.disabled = page >= pageCount - 1;
    next.onclick = () => { page++; renderRecipesPanel(lastRecipes); };
    pager.append(prev, label, next);
  }
}
