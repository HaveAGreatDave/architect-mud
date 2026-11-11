// DEADBALL · THE VIDEOBOARD. The big screen behind left-centre (gl/ballpark-mesh.js jumboFrame),
// across centre field from the scoreboard's lamps. What it shows, most wanted first:
//
//   a replay being taken      the frames as they come in, under a REPLAY bug
//   a prompt                  HOME RUN!, a chant (LET'S GO, CHARGE!, DE-FENSE!), MAKE SOME NOISE
//                             with a meter on the crowd, WHAT A PLAY!; the park sound starts the
//                             chant and says so (diamond/sound.js onHype), so the words land on the beat
//   the replay again          the frames it took, looped twice at the speed they were taken, with
//                             the play's sound word lettered over it (a comic replay off the
//                             broadcast has its word in the picture already, and gets none)
//   the score                 the clubs in their colours, the runs, the inning, who's up
//
// A replay's frames are the picture itself: on the broadcast, the main canvas (and the comic
// overlay over it) as the replay plays on it; in the stands, where nobody shows you a replay, the
// grandstand stages one anyway and draws it now and then from its own camera just for this board.
// With the comic look on, every frame is printed as a comic's panel is (comic.js printPanel) and the
// prompts are lettered and burst the way the comic replay's are.
//
// The board paints a JUMBO_W by JUMBO_H canvas and hands it to `upload` (gl/ballpark.js setJumbo)
// at most JUMBO.fps times a second, and only when what's on it moves.

export const JUMBO_W = 320, JUMBO_H = 180;
// fps: how often it repaints; take: how many frames a second a replay is taken at, by the page's
// clock and not by counting the screen's frames (at 60 Hz every other frame filled the reel in five
// seconds, and the board then sat on its last frame for the rest of a thirteen-second comic replay);
// maxFrames: the most a replay keeps, and a longer one is thinned to every other frame and taken on
// at half the rate, so the whole of it is always there; loops: how many times a replay plays again;
// prompt: how long a prompt holds by default (s)
export const JUMBO = Object.freeze({ fps: 15, take: 12, maxFrames: 168, loops: 2, prompt: 4.5 });

// What the prompts say. `{home}` is the home club's tag.
export const PROMPTS = Object.freeze({
  homerun: ['HOME RUN!'], walkoff: ['WALK-OFF!'], letsgo: ["LET'S GO", '{home}!'], charge: ['CHARGE!'],
  defense: ['DE-', 'FENSE!'], noise: ['MAKE SOME', 'NOISE!'], play: ['WHAT A', 'PLAY!'],
});
// how long one beat of each chant is (s), matching its patch (client/shared/deadball-sfx.js)
const BEAT = { letsgo: 0.375, defense: 0.5, charge: 0.25 };

const HOUSE = { home: ['#36c4c4', '#145f63'], away: ['#e0702e', '#7c2f10'] };
const FACE = (px) => `${px}px Bungee, "Arial Black", Impact, sans-serif`;
const LABEL = (px) => `${px}px Audiowide, Bahnschrift, "Segoe UI", sans-serif`;

export function promptLines(kind, home = '') {
  return (PROMPTS[kind] || [String(kind || '').toUpperCase()]).map((l) => l.replace('{home}', String(home || 'HOME').toUpperCase()));
}

// `doc`: the document (for canvases); `upload(canvas)`: onto the screen; `comic()`: whether the
// comic look's on; `M`: diamond/comic.js, for its printer and its lettering.
export function createJumbo({ doc, upload = () => {}, comic = () => false, M = null } = {}) {
  const canvas = doc?.createElement?.('canvas');
  if (!canvas) return null;
  canvas.width = JUMBO_W; canvas.height = JUMBO_H;
  const g = canvas.getContext('2d');
  if (!g) return null;
  let prompt = null, rec = null, clip = null, lastPaint = -1, lastKey = '';

  // a frame off a picture, cut to 16:9 from its middle and printed if the comic look's on. `print`
  // false is a frame that's a print already (the comic replay's freeze and its page, whose overlay
  // is the printed panel): printed again, its lettering and its dots were inked a second time
  function grab(src, over, print = true) {
    const c = doc.createElement('canvas');
    c.width = JUMBO_W; c.height = JUMBO_H;
    const x = c.getContext('2d'), w = src.width | 0, h = src.height | 0;
    if (!x || !(w > 0 && h > 0)) return null;
    const k = Math.min(w / JUMBO_W, h / JUMBO_H), sw = JUMBO_W * k, sh = JUMBO_H * k, sx = (w - sw) / 2, sy = (h - sh) / 2;
    try {
      x.drawImage(src, sx, sy, sw, sh, 0, 0, JUMBO_W, JUMBO_H);
      if (over && over.width > 1) x.drawImage(over, sx * over.width / w, sy * over.height / h, sw * over.width / w, sh * over.height / h, 0, 0, JUMBO_W, JUMBO_H);
    } catch { return null; }
    return print && comic() && M?.printPanel ? M.printPanel(doc, c) : c;
  }

  // ── painting ──────────────────────────────────────────────────────────────
  function outlined(text, x, y, px, fill, ink = '#000', face = FACE) {
    g.font = face(px); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = Math.max(2, px * 0.16); g.strokeStyle = ink; g.strokeText(text, x, y);
    g.fillStyle = fill; g.fillText(text, x, y);
  }
  function fit(text, px, most) {
    g.font = FACE(px);
    const w = g.measureText(text).width || text.length * px * 0.8;
    return w > most ? Math.floor(px * most / w) : px;
  }
  function bug(word) {
    g.fillStyle = '#c4161c'; g.fillRect(8, 8, 74, 20);
    g.font = LABEL(13); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(word, 45, 18.5);
  }
  function paintFrame(f, word, sinceLoop) {
    if (f) g.drawImage(f, 0, 0); else { g.fillStyle = '#05070a'; g.fillRect(0, 0, JUMBO_W, JUMBO_H); }
    bug('REPLAY');
    if (!word) return;
    if (comic() && M?.paintWord) M.paintWord(g, word, JUMBO_W * 0.62, JUMBO_H * 0.8, 30, sinceLoop, -0.1, 5);
    else outlined(word, JUMBO_W * 0.62, JUMBO_H * 0.82, 26, '#ffd23a');
  }
  function paintPrompt(P, t, info) {
    const since = t - P.at, cols = info.colours?.home || HOUSE.home;
    const beat = BEAT[P.kind], on = beat ? Math.floor(since / beat) % 2 === 0 : Math.floor(since * 4) % 2 === 0;
    g.fillStyle = on ? cols[1] : '#05070a'; g.fillRect(0, 0, JUMBO_W, JUMBO_H);
    // rays from the middle, turning
    g.save(); g.translate(JUMBO_W / 2, JUMBO_H / 2); g.rotate(since * 0.6);
    g.fillStyle = cols[0]; g.globalAlpha = 0.35;
    for (let k = 0; k < 12; k++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(240, -26); g.lineTo(240, 26); g.closePath(); g.fill(); }
    g.restore(); g.globalAlpha = 1;
    const lines = promptLines(P.kind, info.home), big = ['homerun', 'walkoff', 'play'].includes(P.kind);
    if (big && comic() && M?.paintBurst) M.paintBurst(g, JUMBO_W / 2, JUMBO_H / 2, 96, Math.min(1, since / 0.18), 11);
    // a chant's lines come up one a beat, the way the crowd shouts them
    const shown = beat ? Math.min(lines.length, 1 + Math.floor((since % (beat * 4)) / beat)) : lines.length;
    const step = lines.length > 1 ? 56 : 0, y0 = JUMBO_H / 2 - step * (lines.length - 1) / 2 - (P.kind === 'noise' ? 14 : 0);
    lines.slice(0, shown).forEach((l, i) => {
      const px = fit(l, lines.length > 1 ? 50 : 62, JUMBO_W - 30);
      if (comic() && M?.paintWord) M.paintWord(g, l, JUMBO_W / 2, y0 + i * step, px, since - i * (beat || 0.15), i % 2 ? 0.08 : -0.1, 3 + i);
      else outlined(l, JUMBO_W / 2, y0 + i * step, px, i % 2 ? '#fff' : '#ffd23a');
    });
    if (P.kind === 'noise') {
      // the noise meter: how loud the home fans are now, and the most they've been
      const lvl = Math.max(0, Math.min(1, info.loud ?? 0));
      P.peak = Math.max(P.peak || 0, lvl);
      const x0 = 30, w = JUMBO_W - 60, y = JUMBO_H - 30;
      g.fillStyle = '#111'; g.fillRect(x0 - 3, y - 3, w + 6, 20);
      const grad = g.createLinearGradient(x0, 0, x0 + w, 0);
      grad.addColorStop(0, '#2bd14b'); grad.addColorStop(0.6, '#ffd23a'); grad.addColorStop(1, '#ff2a2a');
      g.fillStyle = grad; g.fillRect(x0, y, w * lvl, 14);
      g.fillStyle = '#fff'; g.fillRect(x0 + w * P.peak - 1, y - 3, 3, 20);
    }
  }
  function paintScore(info) {
    const S = info.S || {}, ca = info.colours?.away || HOUSE.away, ch = info.colours?.home || HOUSE.home;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, JUMBO_W, JUMBO_H);
    const row = (y, tag, runs, c) => {
      g.fillStyle = c[0]; g.fillRect(16, y, 200, 40);
      g.fillStyle = c[1]; g.fillRect(216, y, 88, 40);
      outlined(String(tag || '').slice(0, 4).toUpperCase(), 116, y + 21, 26, '#fff');
      outlined(String(runs | 0), 260, y + 21, 28, '#fff');
    };
    row(14, S.away || 'AWY', S.aScore, ca);
    row(60, S.home || 'HOM', S.hScore, ch);
    g.font = LABEL(15); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd23a';
    const inn = S.inning | 0;
    g.fillText(inn ? `${S.half === 'top' ? 'TOP' : 'BOTTOM'} ${inn}` : 'DEADBALL', JUMBO_W / 2, 122);
    const up = info.batter ? `${S.matchup?.bNum != null ? `#${S.matchup.bNum} ` : ''}${String(info.batter).toUpperCase()}` : '';
    if (up) { g.fillStyle = '#fff'; g.font = LABEL(Math.min(15, Math.floor(15 * 280 / Math.max(1, up.length * 11)))); g.fillText(`AT BAT  ${up}`, JUMBO_W / 2, 152); }
  }

  return {
    canvas,
    // a replay's being taken: `kind` (replay.js) and the sound word to letter over it
    recordStart(kind, word = '') { rec = { kind, word, frames: [], times: [], gap: 1 / JUMBO.take }; },
    // `t` the page's clock (s). Called as often as you like: a frame's taken when one's due.
    // `o.print` false for a picture that's printed already (grab).
    record(src, over = null, t = 0, o = {}) {
      if (!rec || !src) return;
      const n = rec.times.length;
      if (n && t >= rec.times[n - 1] && t - rec.times[n - 1] < rec.gap - 1e-3) return;
      if (n >= JUMBO.maxFrames) {
        rec.frames = rec.frames.filter((_, i) => i % 2 === 0); rec.times = rec.times.filter((_, i) => i % 2 === 0);
        rec.gap *= 2;
      }
      const f = grab(src, over, o.print !== false);
      if (f) { rec.frames.push(f); rec.times.push(t); }
    },
    // the replay's done: it plays again on the board, at the speed it was taken, from when the
    // board first has room for it (a prompt up at the time used to run its two loops out unseen)
    recordEnd() {
      if (rec && rec.frames.length > 4) {
        const span = rec.times[rec.times.length - 1] - rec.times[0];
        clip = { ...rec, at: null, rate: span > 0 ? (rec.frames.length - 1) / span : JUMBO.take };
      }
      rec = null;
    },
    get recording() { return !!rec; },
    // whether a frame's wanted at t: for a caller that has to draw one specially (the board's own replay)
    due(t) { const n = rec ? rec.times.length : 0; return !!rec && (!n || t < rec.times[n - 1] || t - rec.times[n - 1] >= rec.gap - 1e-3); },
    // 'replay' while a replay's on the board (being taken, or playing again), for the suite's screen
    get showing() { return rec ? 'replay' : clip && !prompt ? 'replay' : prompt ? 'prompt' : 'score'; },
    // a prompt for `secs`; a home run's or a walk-off's isn't cut short by a chant
    prompt(kind, t, secs = JUMBO.prompt) {
      if (prompt && ['homerun', 'walkoff'].includes(prompt.kind) && t < prompt.until && !['homerun', 'walkoff'].includes(kind)) return;
      prompt = { kind, at: t, until: t + secs };
    },
    // a new at-bat or a half-inning: an old replay's had its turn
    clearClip() { clip = null; },
    // `t`: seconds on the page's clock; `info`: { S, batter, home, colours, loud }
    tick(t, info = {}) {
      if (lastPaint >= 0 && t - lastPaint < 1 / JUMBO.fps && t >= lastPaint) return;
      if (prompt && t >= prompt.until) prompt = null;
      let key;
      if (rec) {
        key = `rec${rec.frames.length}`;
        if (key !== lastKey) paintFrame(rec.frames[rec.frames.length - 1], '', Infinity);
      } else if (prompt) {
        key = `p${t}`;
        paintPrompt(prompt, t, info);
      } else if (clip) {
        if (clip.at == null) clip.at = t;
        const n = clip.frames.length, len = n / clip.rate, k = Math.floor((t - clip.at) / len);
        if (k >= JUMBO.loops) clip = null;
        else {
          const s = (t - clip.at) - k * len, i = Math.min(n - 1, Math.floor(s * clip.rate));
          key = `c${k}.${i}`;
          if (key !== lastKey) paintFrame(clip.frames[i], clip.word, s);
        }
      }
      if (key === undefined) {
        // the score, painted again when anything on it changes, the clubs' colours too (they come
        // in after the first paint, and the board kept the house colours all game)
        const S = info.S || {}, C = info.colours || {};
        key = `s${S.away}${S.aScore}${S.home}${S.hScore}${S.inning}${S.half}${info.batter}${S.matchup?.bNum}${comic()}${C.home}${C.away}`;
        if (key !== lastKey) paintScore(info);
      }
      lastPaint = t;
      if (key === lastKey) return;
      lastKey = key;
      upload(canvas);
    },
  };
}
