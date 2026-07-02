import { esc } from '../catalogs.js';

// Pinned camera feeds. Each configured camera id resolves to a live frame from
// the feeds cache (fed by panel_feed pushes); unknown/unpowered cams show offline.
export function renderStickycam(bodyEl, ctx) {
  const cams = ctx.config.cameras || [];
  if (!cams.length) { bodyEl.innerHTML = '<div class="cpanel-empty">No cameras selected.</div>'; return; }
  bodyEl.innerHTML = cams.map(id => {
    const feed = (ctx.feeds && ctx.feeds[id]) || {};
    const status = feed.status || 'offline';
    const frame = feed.frame || (status === 'offline' ? '— no signal —' : '…');
    return `<div class="cpanel-cam cpanel-cam-${esc(status)}">` +
      `<div class="cpanel-cam-head"><span>${esc(feed.label || id)}</span><span class="cpanel-cam-status">${esc(status)}</span></div>` +
      `<div class="cpanel-cam-frame">${esc(frame)}</div></div>`;
  }).join('');
}
