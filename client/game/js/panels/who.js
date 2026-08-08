import { state } from '../state.js';
import { openWhisperTab } from './whisper.js';

let _whoPlayers = [];

export async function openWhoModal() {
  const modal = document.getElementById('who-modal');
  modal.style.display = 'flex';
  document.getElementById('who-search').value = '';
  document.getElementById('who-list').innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:0.75rem">Loading…</div>';
  try {
    const r = await fetch('/api/players/online');
    const data = await r.json();
    const myHandle = document.getElementById('handle-display')?.textContent?.trim();
    _whoPlayers = Array.isArray(data) ? data.filter(p => p.handle !== myHandle) : [];
  } catch { _whoPlayers = []; }
  _renderWhoList(_whoPlayers);
}

function closeWhoModal() {
  document.getElementById('who-modal').style.display = 'none';
}

function filterWhoList() {
  const q = document.getElementById('who-search').value.toLowerCase();
  _renderWhoList(q ? _whoPlayers.filter(p => p.handle.toLowerCase().includes(q)) : _whoPlayers);
}

const IS_ADMIN = () => ['admin','dev','builder','designer'].includes(state.myRole);

function _renderWhoList(players) {
  const list = document.getElementById('who-list');
  if (!players.length) { list.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:0.75rem">No players online.</div>'; return; }
  const myHandle = document.getElementById('handle-display')?.textContent?.trim();
  list.innerHTML = players.map(p => {
    const isSelf = p.handle === myHandle;
    const whisperBtn = isSelf ? '' : `<button data-whisper="${p.handle.replace(/"/g,'&quot;')}" title="Whisper ${p.handle}" style="background:transparent;border:1px solid var(--accent);color:var(--accent);font-family:var(--font-mono);font-size:0.625rem;padding:2px 6px;cursor:pointer;border-radius:2px">✉</button>`;
    const adminBtns = (!isSelf && IS_ADMIN()) ? `
      <button data-smite-id="${p.id}" data-smite-handle="${p.handle.replace(/"/g,'&quot;')}" style="background:transparent;border:1px solid var(--red);color:var(--red);font-family:var(--font-mono);font-size:0.625rem;padding:2px 6px;cursor:pointer;border-radius:2px">⚡</button>
      <button data-kick-id="${p.id}" data-kick-handle="${p.handle.replace(/"/g,'&quot;')}" style="background:transparent;border:1px solid var(--red);color:var(--red);font-family:var(--font-mono);font-size:0.625rem;padding:2px 6px;cursor:pointer;border-radius:2px">kick</button>` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-weight:600;color:${isSelf?'var(--accent)':'var(--text-bright)'};font-size:0.75rem">${p.handle}${isSelf?' (you)':''}</span>
        ${IS_ADMIN() ? `<span style="color:var(--text-dim);font-size:0.625rem;margin-left:8px">${p.current_zone||''}</span>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:center">${whisperBtn}${adminBtns}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-whisper]').forEach(btn => {
    btn.addEventListener('click', () => { openWhisperTab(btn.dataset.whisper); closeWhoModal(); });
  });
  list.querySelectorAll('[data-smite-id]').forEach(btn => {
    btn.addEventListener('click', () => { _whoSmite(btn.dataset.smiteId); closeWhoModal(); });
  });
  list.querySelectorAll('[data-kick-id]').forEach(btn => {
    btn.addEventListener('click', () => { _whoKick(btn.dataset.kickId, btn.dataset.kickHandle); closeWhoModal(); });
  });
}

async function _whoSmite(id) {
  const token = sessionStorage.getItem('devpanel-token');
  if (!token) return;
  await fetch(`/api/players/${id}/smite`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

async function _whoKick(id, handle) {
  const token = sessionStorage.getItem('devpanel-token');
  if (!token) return;
  const reason = prompt(`Kick ${handle} — reason (optional):`);
  if (reason === null) return;
  const adminHandle = document.getElementById('handle-display')?.textContent?.trim() || 'An administrator';
  await fetch(`/api/players/${id}/kick`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, adminHandle }) });
}

export function initWho() {
  document.getElementById('who-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('who-modal')) closeWhoModal();
  });
  document.getElementById('who-search').addEventListener('input', filterWhoList);

  const closeBtn = document.querySelector('#who-modal button[onclick]');
  if (closeBtn) closeBtn.removeAttribute('onclick');
  document.querySelector('#who-modal .who-close-btn')?.addEventListener('click', closeWhoModal);
  // Find the close button by its content
  document.querySelectorAll('#who-modal button').forEach(btn => {
    if (btn.textContent.trim() === '✕') btn.addEventListener('click', closeWhoModal);
  });
}
