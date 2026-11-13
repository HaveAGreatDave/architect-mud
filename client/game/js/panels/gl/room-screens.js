// GLASS 2 · WHAT A COMPUTER'S MONITOR SHOWS in the Room Stage. A piece names its page in
// `flags.look.screen` (gl/room-office.js puts it on the monitor as the texture 'roomScreen|<page>'),
// and gl/room-mesh.js paintRoomTexture hands that key here. A page is a still picture of an app open
// on the desktop, painted once onto a canvas at the monitor's shape (a 21:9 panel). An unknown page is
// the plain desktop.

// laid out on a 1008 x 432 page and drawn a quarter bigger, so it reads from the chair
const CW = 1260, CH = 540, W = 1008, H = 432;

// the hour in the game, set by the Room Stage from the server's clock before a room is drawn
let screenHour = 21.8;
export function setScreenHour(h) { if (Number.isFinite(h)) screenHour = ((h % 24) + 24) % 24; }
const greeting = h => h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 22 ? 'Good evening' : 'Hello, night owl';
const clockText = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');

export function paintDesktop(doc, page) {
  const c = doc.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  g.scale(CW / W, CH / H);
  (PAGES[page] || PAGES.desktop)(g);
  return c;
}

const PAGES = {
  // a dark desktop: a gradient, a taskbar, a clock
  desktop(g) {
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#1a1030'); grd.addColorStop(0.5, '#2a1450'); grd.addColorStop(1, '#0c2a3a');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,10,14,0.85)'; g.fillRect(0, H - 34, W, 34);
    g.fillStyle = '#e8e8f0'; g.font = '600 16px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(clockText(screenHour), W - 18, H - 12);
  },
  // the Claude app: a sidebar of chats, the mark and a greeting over the box you type in
  claude(g) {
    const ink = '#f0eee6', dim = '#9c9a92', paper = '#262624', side = '#1f1e1d', clay = '#d97757';
    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    // the window's own bar
    g.fillStyle = '#1a1918'; g.fillRect(0, 0, W, 26);
    for (const [i, col] of ['#ff5f57', '#febc2e', '#28c840'].entries()) { g.fillStyle = col; g.beginPath(); g.arc(18 + i * 18, 13, 5.5, 0, Math.PI * 2); g.fill(); }
    // the sidebar
    const sw = 230;
    g.fillStyle = side; g.fillRect(0, 26, sw, H - 26);
    g.fillStyle = '#3a3936'; g.fillRect(sw - 1, 26, 1, H - 26);
    g.fillStyle = ink; g.font = '500 26px Georgia, "Times New Roman", serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Claude', 22, 62);
    pill(g, 16, 92, sw - 32, 34, 17, '#30302e', '#45443f');
    spark(g, 36, 109, 8, clay);
    g.fillStyle = ink; g.font = '600 15px system-ui, "Segoe UI", sans-serif'; g.fillText('New chat', 52, 110);
    g.fillStyle = dim; g.font = '600 12px system-ui, "Segoe UI", sans-serif'; g.fillText('Recents', 22, 152);
    const chats = ['Rewiring the shop alarm', 'Cheap protein, no kitchen', 'Is my landlord allowed', 'Bonsai: when to clip', 'Draft: noise complaint', 'Tide tables for the Basin', 'Explain this ion forecast'];
    g.font = '14px system-ui, "Segoe UI", sans-serif';
    chats.forEach((t, i) => {
      if (i === 0) { g.fillStyle = '#363532'; rr(g, 12, 166 + i * 34, sw - 24, 28, 7); g.fill(); }
      g.fillStyle = i === 0 ? ink : '#c2c0b6'; g.fillText(t, 22, 181 + i * 34);
    });
    g.fillStyle = '#4a4944'; g.beginPath(); g.arc(34, H - 30, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = ink; g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('R', 34, H - 29);
    g.textAlign = 'left'; g.font = '14px system-ui, sans-serif'; g.fillText('Resident, 30B', 56, H - 29);
    // the middle: the mark and a greeting, and the box under them
    const mx = sw + (W - sw) / 2;
    spark(g, mx - 150, 185, 22, clay);
    g.fillStyle = ink; g.font = '400 40px Georgia, "Times New Roman", serif'; g.textAlign = 'left';
    g.fillText(greeting(screenHour), mx - 116, 187);
    const bx = mx - 300, by = 232, bw = 600, bh = 104;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 18; g.shadowOffsetY = 4;
    pill(g, bx, by, bw, bh, 18, '#30302e', '#4a4944'); g.restore();
    g.fillStyle = dim; g.font = '17px system-ui, "Segoe UI", sans-serif'; g.fillText('How can I help you today?', bx + 22, by + 34);
    // the caret, as if it's waiting
    g.fillStyle = ink; g.fillRect(bx + 20, by + 22, 2, 24);
    // the row under it: attach, the model, send
    g.strokeStyle = '#55534e'; g.lineWidth = 1.5;
    rr(g, bx + 16, by + bh - 44, 32, 30, 8); g.stroke();
    g.fillStyle = '#c2c0b6'; g.font = '20px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('+', bx + 32, by + bh - 28);
    g.textAlign = 'right'; g.fillStyle = '#c2c0b6'; g.font = '14px system-ui, sans-serif'; g.fillText('Claude Opus  ⌄', bx + bw - 62, by + bh - 28);
    g.fillStyle = clay; rr(g, bx + bw - 50, by + bh - 45, 34, 32, 8); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(bx + bw - 33, by + bh - 20); g.lineTo(bx + bw - 33, by + bh - 37); g.moveTo(bx + bw - 40, by + bh - 30); g.lineTo(bx + bw - 33, by + bh - 37); g.lineTo(bx + bw - 26, by + bh - 30); g.stroke();
    // a few suggestions under the box
    g.textAlign = 'left'; g.font = '14px system-ui, sans-serif';
    let x = bx + 40;
    for (const t of ['Write', 'Learn', 'Code', 'Life stuff']) {
      const tw = g.measureText(t).width + 28;
      pill(g, x, by + bh + 22, tw, 32, 16, paper, '#4a4944');
      g.fillStyle = '#c2c0b6'; g.fillText(t, x + 14, by + bh + 39);
      x += tw + 12;
    }
  },
};

// Claude's mark: rays of slightly different lengths round a point, round-ended.
function spark(g, x, y, r, col) {
  g.save(); g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = Math.max(2, r * 0.26);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, l = r * (0.78 + 0.22 * ((i * 7) % 3) / 2);
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.restore();
}
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function pill(g, x, y, w, h, r, fill, stroke) {
  rr(g, x, y, w, h, r); g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke();
}
