// Tablet OS — Surveillance (SPECTER) app. Wraps the surveillance plugin's spy-deck
// hub + microreel viewer into the tablet shell, the way corp-app.js wraps the corp
// console. No surveillance logic is duplicated: the live hub data comes from
// hubDataFor(), record/clip/clear delegate to the plugin's own commands, and a
// microreel plays back inside the app's own inline viewer (view: 'reel') from
// getMicroreel() — no separate replay-deck overlay. The live-cam view refreshes by
// client-side polling (the tablet has no proactive push) matched to the deck's 5s
// frame cadence — see tablet-os.js renderSurveillance/the poll timer.
import { registerTabletApp, normScreen } from './registry.js';

// Dynamic import (cached module — same instance the plugin loader already booted),
// so the tablet stays load-order-agnostic re: the surveillance plugin.
const surv = () => import('../surveillance/index.js');

async function buildHome(player) {
  const s = await surv();
  if (!(await s.isSpecterInstalled(player))) return { installed: false };
  const { tiles } = await s.hubDataFor(player);
  return {
    installed: true,
    cams: tiles.length,
    recording: tiles.filter(t => t.recording).length,
    notify: await s.pendingClipCount(player),   // reels waiting to be clipped → home badge
  };
}

async function buildScreen(player, screenId, params) {
  const s = await surv();
  const screen = normScreen(screenId);
  const sel = (params || '').trim();

  // ── Microreels ─────────────────────────────────────────────────────────────
  // The list of saved recordings. Clicking one (its clip id arrives as params)
  // opens the app's OWN inline viewer (view: 'reel') — no separate replay deck.
  // Matches both the link token ('chips') and the re-nav'd breadcrumb label
  // ('microreels') a list-item click sends back.
  if (screen === 'chips' || screen === 'microreels') {
    if (sel) {
      const reel = await s.getMicroreel(player, sel).catch(() => null);
      if (reel) {
        return {
          view: 'reel',
          breadcrumb: ['Surveillance', 'Microreels', reel.zone],
          reel,
        };
      }
    }
    const reels = await s.microreelList(player);
    return {
      view: 'list',
      breadcrumb: ['Surveillance', 'Microreels'],
      items: reels.map(c => ({
        id: c.clipId,
        label: c.name,
        sub: `${c.zone} · ${c.frames} frame${c.frames === 1 ? '' : 's'}${c.crimeTags?.length ? ` · EVIDENCE: ${c.crimeTags.join(', ')}` : ''}`,
        badge: c.crimeTags?.length ? 'illegal' : null,
      })),
      empty: 'No microreels yet. Record a camera, then Clip its buffer to save a reel here.',
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
  // the operator can read what's on tape before saving it to a reel.
  const focusBuffer = sel ? await s.cameraBufferLines(player, sel) : null;
  // A consumer tape deck in the room can take a feed as its input, so a focused cam
  // gets a "patch to the screen" action. broadcast owns the deck and every gate on
  // it; this is only asking whether there's one here (cache read, no query).
  const bc = await import('../broadcast/index.js').catch(() => null);
  const deck = bc?.miniDeckHere ? bc.miniDeckHere(player.current_zone) : null;
  return {
    view: 'surveillance', live: true, breadcrumb: ['Surveillance'],
    net: liveNet || net, tiles, alerts, links,
    focusId: sel || null, focusBuffer,
    deckHere: deck?.name || null,
    deckCam: deck?.camDeviceId || null,
  };
}

async function handleAction(player, actionId, params, broadcast) {
  const s = await surv();
  const focus = (params || '').trim();

  // delete — permanently destroy a saved microreel (the clip id arrives as params),
  // then drop back to the Microreels list so the deleted reel is gone from view.
  // (These three used to be the ONLY callers of deleteMicroreel /
  // selfDestructDevice / patchCamToDeck anywhere, which made scuttling a device
  // or destroying a reel impossible without a tablet. The verbs `crush`,
  // `destruct` and `cast` now exist; the app still calls the underlying function
  // directly because it already holds the exact id and has its own confirm UI,
  // whereas the verbs resolve by name and confirm in text.)
  if (actionId === 'delete') {
    if (focus) await s.deleteMicroreel(player, focus);
    return buildScreen(player, 'microreels', '');
  }

  // destruct — remote-kill one of your own planted devices (the focused cam id
  // arrives as params). The unit is destroyed, not recovered; re-render the hub
  // unfocused since the tile it was showing is gone.
  if (actionId === 'destruct') {
    if (focus) await s.selfDestructDevice(player, focus);
    return buildScreen(player, null, '');
  }

  // cast — put the focused camera on the consumer deck in this room (or pull it
  // back off). broadcast decides whether that's allowed; we just re-render focused.
  if (actionId === 'cast') {
    const bc = await import('../broadcast/index.js').catch(() => null);
    if (bc?.patchCamToDeck && focus) await bc.patchCamToDeck(player, focus);
    return buildScreen(player, null, focus);
  }

  // record/clip/wipe run the plugin's own verbs (same behaviour as the standalone
  // hub buttons): record toggles the tape, clip saves a microreel + clears the
  // buffer, clear (wipe) discards it. Then re-render the hub focused on the cam.
  if (actionId === 'record' || actionId === 'clip' || actionId === 'clear') {
    const verb = actionId === 'clear' ? 'wipe' : actionId;
    const cmd = s.commands[verb];
    if (cmd) await cmd(focus ? [focus] : [], `${verb} ${focus}`.trim(), player, broadcast);
    return buildScreen(player, null, focus);
  }
  return buildScreen(player, null, '');
}

// NOTE: the Wanted home-screen card lives in crime-app.js, not here. Your own heat
// is a matter for your rap sheet; SPECTER is the kit you point at everyone else.

registerTabletApp({
  id: 'specter', name: 'Surveillance', icon: '📡', category: 'Espionage',
  verbs: ['hub', 'clips'],
  buildHome, buildScreen, handleAction,
});
