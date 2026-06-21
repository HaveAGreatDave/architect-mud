import { state } from '../state.js';
import { sendDialogue } from '../net.js';

export function openDialogue(msg) {
  state.currentNpcId = msg.npcId;
  document.getElementById('dialogue-npc-name').textContent = msg.npcName;
  document.getElementById('dialogue-text').innerHTML = msg.text;
  const opts = document.getElementById('dialogue-options');
  opts.innerHTML = '';
  for (const opt of (msg.options || [])) {
    if (!opt.next) continue;
    const btn = document.createElement('button');
    btn.className = 'dialogue-opt';
    btn.textContent = opt.label;
    btn.onclick = () => sendDialogue(state.currentNpcId, opt.next);
    opts.appendChild(btn);
  }
  document.getElementById('dialogue-panel').classList.add('active');
}

export function closeDialogue() {
  document.getElementById('dialogue-panel').classList.remove('active');
  state.currentNpcId = null;
}

export function initDialogue() {
  document.getElementById('dialogue-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dialogue-panel')) closeDialogue();
  });
  // Wire the static "[ Leave ]" button
  document.querySelectorAll('#dialogue-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Leave')) btn.addEventListener('click', closeDialogue);
  });
}
