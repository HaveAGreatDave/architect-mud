// THE STAGE ON THE TV. Any show that airs as text, played on its set with its people as the lines air
// (sequence-player.js `live`). The TV's 3-D button turns it on, and it stays on for the next show. The
// server answers `tv_stage` with the set and who's on it (plugins/broadcast/sequences.js stageFor), and
// each line the TV shows is a cut. A sports broadcast has its own picture, so this stands aside for one.
//
// The picture loads the first time it's turned on, so a viewer who never presses it downloads nothing.

export const STAGE_KEY = 'tv.stage';
export function stageWanted() { try { return globalThis.localStorage?.getItem(STAGE_KEY) === '1'; } catch { return false; } }
export function rememberStage(on) { try { globalThis.localStorage?.setItem(STAGE_KEY, on ? '1' : '0'); } catch { /* fine without */ } }

const SAYS = /^(.+?) says, "([\s\S]*)"$/;
const plain = (html) => new DOMParser().parseFromString(String(html), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();

// The line along the bottom of the picture: the picture covers the TV's own text, and a viewer still
// has to be able to read what's said. The desk uses it too.
export function createCaption(host) {
  const el = document.createElement('div');
  el.className = 'tv-stage-caption';
  el.style.cssText = 'position:absolute;left:4%;right:4%;bottom:3%;z-index:5;padding:0.35em 0.7em;background:rgba(6,9,14,0.78);color:#f2f4f8;font:0.82rem/1.35 var(--font-mono,monospace);border-left:3px solid var(--tv-header-color,#39a0ff);pointer-events:none;opacity:0;transition:opacity 0.2s';
  host.appendChild(el);
  return (who, text) => {
    el.innerHTML = '';
    if (!text) { el.style.opacity = '0'; return; }
    if (who) { const b = document.createElement('b'); b.textContent = `${who}: `; b.style.color = 'var(--tv-header-color,#39a0ff)'; el.appendChild(b); }
    el.appendChild(document.createTextNode(text));
    el.style.opacity = '1';
  };
}

// `inset` is where the picture sits on the screen (the CRT's own header and footer by default), and
// `onFrame(host)` hears each frame drawn, for a set that copies its page (room-tv.js).
export function createTvStage(parent, { phone = false, feed = null, inset = null, onFrame = null } = {}) {
  let host = null, player = null, loading = null, key = '', caption = null;

  async function ensurePlayer() {
    if (player) return player;
    loading ??= import('./sequence-player.js').then(({ createSequencePlayer }) => {
      host = document.createElement('div');
      host.className = 'tv-stage';
      host.style.cssText = `position:absolute;inset:${inset || 'var(--tv-head-h,45px) 0 var(--tv-foot-h,72px) 0'};z-index:47;background:#000;overflow:hidden`;
      parent.appendChild(host);
      player = createSequencePlayer(host, { mode: 'cued', phone, feed, onFrame: onFrame && (() => onFrame(host)) });
      if (!player) { host.remove(); host = null; } else caption = createCaption(host);
      return player;
    }).catch((err) => { console.error('[tv] the stage failed to load:', err); loading = null; return null; });
    return loading;
  }

  const api = {
    get open() { return !!key; },
    get player() { return player; },
    // the server's answer: the set and who's on it, for the programme on now
    async show(msg) {
      if (!msg?.set) { this.close(); return; }
      const p = await ensurePlayer();
      if (!p) return;
      host.style.display = '';
      key = `${msg.broadcast || ''}|${msg.programName || ''}`;
      p.liveStart({ set: msg.set, people: msg.people || [], data: { show: msg.programName || '' } });
    },
    // a line as the TV shows it: somebody saying something, or the announcer
    line(text, style) {
      if (!key || !player) return;
      if (style && style !== 'raw' && style !== 'narrate' && style !== 'emote') return;
      const t = plain(text), m = SAYS.exec(t);
      if (m) { player.liveLine(m[1].trim(), m[2].trim()); caption?.(m[1].trim(), m[2].trim()); } else if (t) { player.liveLine('', t); caption?.('', t); }
    },
    voice(name, trace, res) { if (key) player?.voice(name, trace, res?.delay || 0); },
    close() { key = ''; if (host) host.style.display = 'none'; player?.stop(); },
    dispose() { this.close(); player?.dispose(); host?.remove(); player = null; host = null; loading = null; },
  };
  globalThis.__tvStage = api;   // for the console
  return api;
}
