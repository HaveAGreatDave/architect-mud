let _whisperTargetId = null;
let _whisperTargetHandle = null;

const ADMIN_ROLES = new Set(['admin','dev','builder','designer']);

// ── Zone-inline window management ────────────────────────────────────────────
// These are called from the zone edit form's Windows sub-section.

let _whisperPanelOpen = false;

function toggleWhisperPanel() {
  _whisperPanelOpen = !_whisperPanelOpen;
  const panel = document.getElementById('whisper-panel');
  panel.style.display = _whisperPanelOpen ? 'flex' : 'none';
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = _whisperPanelOpen ? 'var(--accent)' : '';
  if (_whisperPanelOpen) document.getElementById('whisper-input')?.focus();
}

function openWhisper(id, handle) {
  _whisperTargetId = id;
  _whisperTargetHandle = handle;
  document.getElementById('whisper-target-label').textContent = `To: ${handle}`;
  document.getElementById('whisper-log').innerHTML = '';
  document.getElementById('whisper-input').value = '';
  const panel = document.getElementById('whisper-panel');
  panel.style.display = 'flex';
  _whisperPanelOpen = true;
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = 'var(--accent)';
  document.getElementById('whisper-input').focus();
}

function closeWhisper() {
  document.getElementById('whisper-panel').style.display = 'none';
  _whisperPanelOpen = false;
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = '';
}

async function sendWhisper() {
  const input = document.getElementById('whisper-input');
  const msg = input.value.trim();
  if (!msg || !_whisperTargetId) return;
  const r = await API(`/players/${_whisperTargetId}/whisper`, 'POST', { message: msg });
  if (r.error) { toast(r.error, true); return; }
  const log = document.getElementById('whisper-log');
  const entry = document.createElement('div');
  entry.style.cssText = 'font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)';
  entry.innerHTML = `<div style="font-size:10px;color:var(--text-dim);margin-bottom:2px">You → ${_whisperTargetHandle}</div>${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  input.value = '';
}

// --- Time & Weather panel ---

