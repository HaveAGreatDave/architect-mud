// THE DESK ON THE TV. A broadcast's `desk` overlays (plugins/broadcast/sequences.js) played through the
// sequence player, over the game. The first overlay of a segment carries its documents, each line
// says which beat it is, and the last says so. It's part of the broadcast on the visual rung, as the
// game is; on the others, or with no WebGL2, the same lines air as text.
//
// The picture loads on the first segment, so a viewer who never sees one downloads nothing.

import { lineSeconds, dig } from '../../../shared/sequence.js';
import { createCaption } from './tv-stage.js';


const LINGER_S = 1.4;   // the last line's picture holds this long after its words

export function createTvDesk(parent, { phone = false, feed = null, inset = null, onFrame = null } = {}) {
  let host = null, player = null, loading = null, closeTimer = 0, pack = null, caption = null;

  async function ensurePlayer() {
    if (player) return player;
    loading ??= import('./sequence-player.js').then(({ createSequencePlayer }) => {
      host = document.createElement('div');
      host.className = 'tv-desk';
      // the screen between the set's header and footer, over the sub-screen (#tv-gameday is 48)
      host.style.cssText = `position:absolute;inset:${inset || 'var(--tv-head-h,45px) 0 var(--tv-foot-h,72px) 0'};z-index:49;background:#000;overflow:hidden`;
      parent.appendChild(host);
      player = createSequencePlayer(host, { mode: 'cued', phone, feed, photo: starPhoto, onFrame: onFrame && (() => onFrame(host)) });
      if (!player) { host.remove(); host = null; } else caption = createCaption(host);
      return player;
    }).catch((err) => { console.error('[tv] the desk failed to load:', err); loading = null; return null; });
    return loading;
  }

  function close() {
    clearTimeout(closeTimer);
    pack = null;
    if (host) host.style.display = 'none';
    player?.stop();
  }

  async function overlay(o) {
    if (o.pack) pack = o.pack;
    if (!pack) return;   // tuned in mid-segment: the game stays up until the next one
    const p = await ensurePlayer();
    if (!p || !pack) return;
    clearTimeout(closeTimer);
    host.style.display = '';
    if (o.pack) p.load(pack);
    p.cue(o.beat);
    const it = p.state?.tl.find((x) => x.i === o.beat);
    caption?.(it?.data?.speaker?.name || '', it?.text || '');
    if (o.last) {
      closeTimer = setTimeout(close, (lineSeconds(it?.text || '') + LINGER_S) * 1000);
    }
  }

  return {
    overlay, close,
    get open() { return !!pack; },
    // the line that's being spoken, with the voice's own timing, for the mouth
    voice(name, trace, res) { if (pack) player?.voice(name, trace, res?.delay || 0); },
    dispose() { close(); player?.dispose(); host?.remove(); player = null; host = null; loading = null; },
  };
}

// A profile's picture: the man on his card, from the same camera (card-photo.js).
async function starPhoto(g, data) {
  const s = g.who ? dig(data, g.who) : null;
  if (!s?.name || !s.league) return null;
  const { cardPhoto } = await import('./card-photo.js');
  return cardPhoto({ league: s.league, name: s.name, team: s.team, pos: s.pos, num: s.num || '' });
}
