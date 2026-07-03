function renderGamesPanel(data) {
  const panel = document.getElementById('list-panel');
  const tables = Array.isArray(data) ? data : [];

  const toolbar = `<div style="padding:16px 16px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="action-btn" onclick="clearAllGameTables()">🃏 Clear all poker tables</button>
  </div>`;

  if (!tables.length) {
    panel.innerHTML = toolbar + '<div style="padding:24px;color:var(--text-dim)">No active tables.</div>';
    return;
  }

  const seatCell = seat => seat
    ? `<span style="color:var(--text-bright)">${seat.handle}</span>${seat.isBot ? ' <span style="color:var(--accent3);font-size:10px">AI</span>' : ''} <span style="color:var(--text-dim)">₵ ${seat.chips.toLocaleString()}</span>`
    : `<span style="color:var(--text-dim)">[ empty ]</span>`;

  const seatRows = t => t.seats.map((s, i) => `<tr>
    <td style="color:var(--text-dim);width:20px">${i + 1}</td>
    <td>${seatCell(s)}</td>
  </tr>`).join('');

  const cardHTML = t => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:14px 16px;margin:0 16px 12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">
        <div>
          <span style="font-weight:600;color:var(--text-bright)">${t.name || t.id}</span>
          <span style="color:var(--text-dim);font-size:11px;margin-left:8px">${t.zoneName}</span>
        </div>
        <div style="font-size:11px;color:${t.phase === 'InProgress' ? 'var(--accent2)' : t.phase === 'WaitingForDealer' ? 'var(--red)' : 'var(--text-dim)'}">
          ${t.phase}${t.dealerName ? ` — dealer: ${t.dealerName}` : ' — NO DEALER'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
        <table style="width:100%">${seatRows(t)}</table>

        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">Blinds</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" id="sb-${t.id}" value="${t.smallBlind}" min="1" style="width:70px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
            <span style="color:var(--text-dim)">/</span>
            <input type="number" id="bb-${t.id}" value="${t.bigBlind}" min="1" style="width:70px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
            <button class="action-btn" style="font-size:10px;padding:5px 10px" onclick="saveBlinds('${t.id}')">Save</button>
          </div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px">Buy-in: ₵ ${t.buyIn.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-dim)">Spectators: ${t.spectatorCount}</div>
        </div>
      </div>
    </div>`;

  panel.innerHTML = toolbar + tables.map(cardHTML).join('');
}

async function saveBlinds(tableId) {
  const smallBlind = Number(document.getElementById(`sb-${tableId}`).value);
  const bigBlind = Number(document.getElementById(`bb-${tableId}`).value);
  const r = await directAPI(`/gametable/tables/${tableId}/blinds`, 'POST', { smallBlind, bigBlind });
  if (r.error) { toast(r.error, true); return; }
  toast(`Blinds updated: ₵ ${smallBlind} / ₵ ${bigBlind}`);
  loadPanel('games');
}

async function clearAllGameTables() {
  if (!(await dpConfirm('Clear all players from every poker table? Seated players and bots are cashed out and stood up.', { danger: true }))) return;
  const r = await directAPI('/gametable/clear-all', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`🃏 Cleared ${r.cleared} occupant(s) from ${r.tables} table(s)`);
  loadPanel('games');
}
