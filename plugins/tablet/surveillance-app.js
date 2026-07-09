// Tablet OS — Surveillance (SPECTER) app. Wraps the surveillance plugin's spy-deck
// hub + microreel replay into the tablet shell, the way corp-app.js wraps the corp
// console. No surveillance logic is duplicated: the live hub data comes from
// hubDataFor(), record/clip delegate to the plugin's own `record`/`clip` commands,
// and opening a chip hands off to the same replay deck `use <datachip>` opens
// (openReplayFor). The live-cam view refreshes by client-side polling (the tablet
// has no proactive push) matched to the deck's 5s frame cadence — see tablet-os.js
// renderSurveillance/the poll timer.
import { registerTabletApp, normScreen } from './registry.js';

// Dynamic import (cached module — same instance the plugin loader already booted),
// so the tablet stays load-order-agnostic re: the surveillance plugin.
const surv = () => import('../surveillance/index.js');

async function buildHome(player) {
  const s = await surv();
  if (!(await s.isSpecterInstalled(player))) return { installed: false };
  const { tiles } = await s.hubDataFor(player);
  return { installed: true, cams: tiles.length, recording: tiles.filter(t => t.recording).length };
}

async function buildScreen(player, screenId, params) {
  const s = await surv();
  const screen = normScreen(screenId);
  const sel = (params || '').trim();

  // ── Microreels ─────────────────────────────────────────────────────────────
  // Clicking a reel (arrives as this screen's params) opens the replay deck as a
  // separate overlay and re-renders the list underneath it — no spy deck needed.
  // Matches both the link token ('chips') and the re-nav'd breadcrumb label
  // ('microreels') a list-item click sends back.
  if (screen === 'chips' || screen === 'microreels') {
    if (sel) await s.openReplayFor(player, sel).catch(() => {});
    const chips = await s.datachipList(player);
    return {
      view: 'list',
      breadcrumb: ['Surveillance', 'Microreels'],
      items: chips.map(c => ({
        id: c.clipId || c.name,
        label: c.name,
        sub: `${c.zone} · ${c.frames} frame${c.frames === 1 ? '' : 's'}${c.crimeTags?.length ? ` · EVIDENCE: ${c.crimeTags.join(', ')}` : ''}`,
        badge: c.crimeTags?.length ? 'illegal' : null,
      })),
    };
  }

  // ── Live hub — the default screen. Gated on SPECTER being installed (the
  // purchased hack-deck program), not on carrying anything. ───────────────────
  const net = { name: `SPECTER // ${player.handle || 'OPERATOR'}`, color: '#39ff9e' };
  const links = [{ id: 'chips', label: 'Microreels' }];
  if (!(await s.isSpecterInstalled(player))) {
    return {
      view: 'surveillance', live: false, locked: true, breadcrumb: ['Surveillance'],
      net, tiles: [], alerts: [], links,
      message: 'SPECTER is not installed. Acquire and use a SPECTER hack-deck program to flash it onto your tablet. Recorded footage is still viewable under Microreels.',
    };
  }
  const { net: liveNet, tiles, alerts } = await s.hubDataFor(player);
  // A focused camera also carries its rolling buffer (the recorded event-lines) so
  // the operator can read what's on tape before burning it to a chip.
  const focusBuffer = sel ? await s.cameraBufferLines(player, sel) : null;
  return {
    view: 'surveillance', live: true, breadcrumb: ['Surveillance'],
    net: liveNet || net, tiles, alerts, links,
    focusId: sel || null, focusBuffer,
  };
}

async function handleAction(player, actionId, params, broadcast) {
  const s = await surv();
  const focus = (params || '').trim();

  // record/clip run the plugin's own verbs (same behaviour as the standalone hub
  // buttons), then re-render the hub focused on the same camera.
  if (actionId === 'record' || actionId === 'clip') {
    const cmd = s.commands[actionId];
    if (cmd) await cmd(focus ? [focus] : [], `${actionId} ${focus}`.trim(), player, broadcast);
    return buildScreen(player, null, focus);
  }
  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'specter', name: 'Surveillance', icon: '📡', category: 'Espionage',
  buildHome, buildScreen, handleAction,
});
