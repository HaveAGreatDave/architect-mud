export function initSkillsPanel() {
  document.getElementById('skills-close').addEventListener('click', closeSkillsPanel);
}

export function closeSkillsPanel() {
  document.getElementById('skills-panel').classList.remove('active');
}

export function renderSkillsPanel(data) {
  const body = document.getElementById('skills-body');
  body.innerHTML = '';

  const intro = document.createElement('div');
  intro.className = 'skills-note';
  intro.innerHTML = `Each skill's effective value = <b>IP level</b> + <b>governing stats</b> + <b>buffs</b>. ` +
    `The IP column shows progress toward the next level (e.g. <b>2.05</b>); combat and checks use the floored level.`;
  body.appendChild(intro);

  for (const group of data.groups) {
    const sec = document.createElement('div');
    sec.className = 'skills-section';

    const cat = document.createElement('div');
    cat.className = 'skills-cat';
    cat.textContent = group.category.toUpperCase();
    sec.appendChild(cat);

    const head = document.createElement('div');
    head.className = 'skills-skill-row skills-colhead';
    head.innerHTML =
      `<span class="skills-skill-name">Skill</span>` +
      `<span class="skills-col">IP</span>` +
      `<span class="skills-col">+Stat</span>` +
      `<span class="skills-col">+Buff</span>` +
      `<span class="skills-col skills-final">Final</span>`;
    sec.appendChild(head);

    for (const sk of group.skills) {
      const block = document.createElement('div');
      block.className = 'skills-block';

      const row = document.createElement('div');
      row.className = 'skills-skill-row';
      row.innerHTML =
        `<span class="skills-skill-name">${sk.name} <span class="skills-gov">${sk.stats.join('/')}</span></span>` +
        `<span class="skills-col">${sk.ipValue}</span>` +
        `<span class="skills-col">${sk.statBonus}</span>` +
        `<span class="skills-col">${sk.buff ? '+' + sk.buff : '—'}</span>` +
        `<span class="skills-col skills-final">${sk.final}</span>`;
      block.appendChild(row);

      const desc = document.createElement('div');
      desc.className = 'skills-desc';
      desc.textContent = sk.desc;
      block.appendChild(desc);

      sec.appendChild(block);
    }

    body.appendChild(sec);
  }
}
