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
// `onFrame(host)` hears each frame drawn, for a set that copies its page (room-tv.js). `onStranger(name)`
// hears a line from somebody the cast it was given doesn't hold: the cast was asked for between shows, or
// before they came on, and the TV asks again rather than drawing them as a stranger.
export function createTvStage(parent, { phone = false, feed = null, inset = null, onFrame = null, onStranger = null } = {}) {
  let host = null, player = null, loading = null, key = '', caption = null, facts = {};
  // A title card (a script's TITLE: a test card, a logo) fills the picture when it airs, and the line
  // straight after it is read over it if nobody on the set says it. The next line takes it down, and
  // from then on it's what the set's own screen shows.
  let cardEl = null, cardRead = false;
  const dropCard = () => { cardEl?.remove(); cardEl = null; cardRead = false; };
  function showCard(text, style) {
    dropCard();
    cardEl = document.createElement('div');
    cardEl.className = 'tv-stage-card';
    cardEl.style.cssText = 'position:absolute;inset:0;z-index:4;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden';
    let svg = null;
    if (style === 'svg') {
      cardEl.innerHTML = String(text);
      svg = cardEl.querySelector('svg');
      if (!svg) { dropCard(); return; }
      const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number), w = box[2] || parseFloat(svg.getAttribute('width')) || 640, h = box[3] || parseFloat(svg.getAttribute('height')) || 360;
      if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      // the set's screen takes a still of it: an image needs a size of its own, which the card on the page mustn't have
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const img = new Image(), el = cardEl;
      img.onload = () => { if (cardEl === el || !cardEl) player?.liveCard(img, w, h); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.style.cssText = 'width:100%;height:100%;display:block';
    } else {
      const pre = document.createElement('pre'), lines = String(text).split('\n'), cols = Math.max(1, ...lines.map((l) => l.length));
      pre.textContent = text;
      pre.style.cssText = `margin:0;color:#e6ece8;font:${Math.min(90 / cols, 60 / lines.length).toFixed(2)}cqmin/1.25 var(--font-mono,monospace);white-space:pre`;
      cardEl.style.containerType = 'size';
      cardEl.appendChild(pre);
      // the same words on the set's screen
      const c = document.createElement('canvas'), px = 22;
      c.width = Math.ceil(cols * px * 0.62) + 80; c.height = Math.ceil(lines.length * px * 1.25) + 60;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#e6ece8'; g.font = `${px}px monospace`; g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l, 40, 30 + i * px * 1.25));
      player?.liveCard(c, c.width, c.height);
    }
    host.appendChild(cardEl);
    caption?.('', '');
  }

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
      dropCard();
      key = `${msg.broadcast || ''}|${msg.programName || ''}`;
      p.liveStart({ set: msg.set, people: msg.people || [], data: { ...facts, show: msg.programName || '' } });
    },
    // a line as the TV shows it: somebody saying something, or the announcer
    line(text, style) {
      if (!key || !player) return;
      if (style && style !== 'raw' && style !== 'narrate' && style !== 'emote') return;
      const t = plain(text), m = SAYS.exec(t);
      if (m) {
        dropCard();
        if (onStranger && !player.liveKnows(m[1].trim())) onStranger(m[1].trim());
        player.liveLine(m[1].trim(), m[2].trim()); caption?.(m[1].trim(), m[2].trim()); return;
      }
      if (!t) return;
      // "Neil slams his fist on the table." is Neil doing it, not the announcer saying it
      if (player.liveAct(t)) { dropCard(); caption?.('', t); return; }
      // the announcer's line straight after a card describes it, so it's read over it; the one after isn't
      if (cardEl) { if (cardRead) dropCard(); else cardRead = true; }
      player.liveLine('', t); caption?.('', t);
    },
    // a title card as it airs (the TV's `svg` and `ascii_art` messages): it takes the picture
    card(text, style) { if (key && player && host && text) showCard(text, style); },
    // a CAM line from the script (the server's `direction` overlay): the next shot is that camera's
    direction(label) { if (key) player?.liveDirection(label); },
    // the show moving somebody: the talk show's host to the star for the monologue, and back (the `blocking` overlay)
    block(name, to) { if (key) player?.liveBlock(name, to); },
    // facts the picture shows as they change (the score bug's score, on an arena's wall); kept for a stage
    // turned on mid-show
    data(patch) { Object.assign(facts, patch); if (key) player?.liveData(patch); },
    voice(name, trace, res) { if (key) player?.voice(name, trace, res?.delay || 0); },
    close() { key = ''; facts = {}; dropCard(); if (host) host.style.display = 'none'; player?.stop(); },
    dispose() { this.close(); player?.dispose(); host?.remove(); player = null; host = null; loading = null; },
  };
  globalThis.__tvStage = api;   // for the console
  return api;
}
