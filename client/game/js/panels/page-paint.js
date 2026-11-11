// A laid-out piece of the page, painted onto a 2-D canvas. The browser can't hand a page to WebGL, so
// this reads what it laid out (boxes, words, pictures, in paint order) and draws the same thing, which
// is how a broadcast gets onto a set in the Room Stage as a texture (room-tv.js).
//
// ⚠ THE ELEMENT HAS TO BE LAID OUT, UNTRANSFORMED AND NOT `visibility: hidden`. Park it off the side of
// the page. Every position here is the element's own client rect, so a CSS animation or transition
// lands where the browser has it at the moment of the paint.
//
// ⚠ IT PAINTS WHAT A BROADCAST USES, NOT ALL OF CSS. Background colours, linear and radial gradients,
// borders, rounded corners, opacity, overflow clips, z-index, words, images, canvases and inline SVG.
// Not repeating or conic gradients, box or text shadows, filters, pseudo-elements, or a rotated box.
// Those are finish on a picture a few feet away; a new overlay that depends on one to be read needs
// it added here.

const px = (s) => parseFloat(s) || 0;
const CLEAR = /^(transparent|rgba\(0, 0, 0, 0\))$/;

// Commas that separate a CSS value's parts, not the ones inside its colours.
function splitTop(s) {
  const out = [];
  let depth = 0, at = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && !depth) { out.push(s.slice(at, i).trim()); at = i + 1; }
  }
  out.push(s.slice(at).trim());
  return out;
}

// `linear-gradient(...)` or `radial-gradient(...)` as a canvas gradient over a box, or null for
// anything else. Only the top layer of a stack of backgrounds.
function gradientOf(g, src, x, y, w, h) {
  const top = splitTop(src)[0], m = /^(linear|radial)-gradient\(([\s\S]*)\)$/.exec(top);
  if (!m) return null;
  const parts = splitTop(m[2]);
  let fill;
  if (m[1] === 'linear') {
    const lead = /^(-?[\d.]+)deg$/.exec(parts[0]) || (/^to /.test(parts[0]) ? [0, { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 }[parts[0]] ?? 180] : null);
    const a = (lead ? Number(lead[1]) : 180) * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a), half = (Math.abs(w * sx) + Math.abs(h * sy)) / 2;
    if (lead) parts.shift();
    fill = g.createLinearGradient(x + w / 2 - sx * half, y + h / 2 - sy * half, x + w / 2 + sx * half, y + h / 2 + sy * half);
  } else {
    const lead = /circle|ellipse|at |closest|farthest|^[\d.]+(%|px)/.test(parts[0]) ? parts.shift() : '', at = /at ([\d.]+)% ([\d.]+)%/.exec(lead);
    const cx = x + w * (at ? at[1] / 100 : 0.5), cy = y + h * (at ? at[2] / 100 : 0.5);
    fill = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
  }
  try {
    parts.forEach((p, i) => {
      const s = /^(.*?)(?:\s+([\d.]+)%)?(?:\s+([\d.]+)%)?$/.exec(p), at0 = s[2] !== undefined ? s[2] / 100 : i / Math.max(1, parts.length - 1);
      fill.addColorStop(Math.min(1, at0), s[1]);
      if (s[3] !== undefined) fill.addColorStop(Math.min(1, s[3] / 100), s[1]);
    });
  } catch { return null; }
  return fill;
}

// What an inline SVG's rules give its shapes, written onto a copy, since the sheets don't reach an
// SVG drawn as an image.
const SVG_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-size', 'font-family', 'font-weight'];
// ⚠ AN ANIMATED SVG IS FROZEN WHERE IT IS. A title card that animates itself in (the CPhL's open wipes its
// wordmark in by a clip rect that starts at no width) is an image at time nought once it's copied, and an
// image's clock never runs on a canvas: the set on the wall showed the bare backdrop for the whole theme.
// So `still` writes what each shape is animated to right now onto the copy and turns its animations off,
// and the painter takes a new copy while anything's moving.
const SVG_MOVING = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'transform', 'transform-origin', 'transform-box',
  'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'clip-path', 'visibility', 'display', 'letter-spacing'];
// ⚠ NOR DOES AN IMAGE LOAD ANYTHING, so a font the SVG names by URL is written into the copy as data. Each
// is fetched once; `fontRev` moves when one lands, and the copy made without it is made again.
const fonts = new Map();
let fontRev = 0;
function withFonts(markup) {
  return markup.replace(/url\((["']?)(\/[^)"']+?\.woff2?)\1\)/g, (all, q, url) => {
    const have = fonts.get(url);
    if (have) return `url(${have})`;
    if (have === undefined) {
      fonts.set(url, null);
      fetch(url).then((r) => (r.ok ? r.blob() : null))
        .then((b) => b && new Promise((done) => { const fr = new FileReader(); fr.onload = () => done(fr.result); fr.onerror = () => done(null); fr.readAsDataURL(b); }))
        .then((data) => { if (data) { fonts.set(url, data); fontRev++; } })
        .catch(() => { /* the fallback face */ });
    }
    return all;
  });
}
function svgMarkup(el, w, h, still) {
  const copy = el.cloneNode(true), from = el.querySelectorAll('*'), to = copy.querySelectorAll('*');
  from.forEach((n, i) => {
    const cs = getComputedStyle(n);
    for (const p of SVG_PROPS) to[i].setAttribute(p, cs.getPropertyValue(p));
    if (!still || !to[i].style) return;
    // inline, since the copy's own sheet outranks an attribute
    for (const p of [...SVG_PROPS, ...SVG_MOVING]) to[i].style.setProperty(p, cs.getPropertyValue(p));
    to[i].style.setProperty('animation', 'none');
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', w); copy.setAttribute('height', h);
  return withFonts(new XMLSerializer().serializeToString(copy));
}
const SVG_MS = 100;   // how often a moving SVG is copied again

// `root` is the element, `canvas` where it goes. `special(el, cs, g, box)` may draw an element itself
// and return true.
export function createPagePaint(root, canvas, { special = null } = {}) {
  const g = canvas.getContext('2d', { alpha: false }), range = document.createRange();
  const images = new Map();
  // A canvas's last frame, for one whose buffer is gone by the time a paint comes round: a WebGL
  // picture only lasts until the task that drew it ends.
  const grabbed = new WeakMap();
  const moving = new WeakMap();   // an animated SVG's copies: { im, next, at, was, key }
  let o = null;

  function imageOf(key, url) {
    let im = images.get(key);
    if (im) return im;
    im = new Image();
    im.src = url;
    images.set(key, im);
    if (images.size > 48) images.delete(images.keys().next().value);
    return im;
  }

  function box(cs, x, y, w, h) {
    const r = px(cs.borderTopLeftRadius), shape = () => { g.beginPath(); if (r && g.roundRect) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else g.rect(x, y, w, h); };
    if (!CLEAR.test(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; shape(); g.fill(); }
    if (cs.backgroundImage !== 'none') {
      const fill = gradientOf(g, cs.backgroundImage, x, y, w, h);
      if (fill) { g.fillStyle = fill; shape(); g.fill(); }
    }
    const top = px(cs.borderTopWidth), right = px(cs.borderRightWidth), bottom = px(cs.borderBottomWidth), left = px(cs.borderLeftWidth);
    const edge = (n, style, col, a, b, c, d) => { if (n && style !== 'none' && !CLEAR.test(col)) { g.fillStyle = col; g.fillRect(a, b, c, d); } };
    edge(top, cs.borderTopStyle, cs.borderTopColor, x, y, w, top);
    edge(bottom, cs.borderBottomStyle, cs.borderBottomColor, x, y + h - bottom, w, bottom);
    edge(left, cs.borderLeftStyle, cs.borderLeftColor, x, y, left, h);
    edge(right, cs.borderRightStyle, cs.borderRightColor, x + w - right, y, right, h);
  }

  // Word by word, each at the spot the browser put it, so wrapping and alignment need no working out
  // and runs of spaces in ASCII art keep their width.
  function words(node, cs) {
    const s = node.data;
    if (!/\S/.test(s)) return;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in g) g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    g.fillStyle = cs.color;
    const asc = g.measureText('Mg').fontBoundingBoxAscent, up = cs.textTransform === 'uppercase', low = cs.textTransform === 'lowercase';
    for (const m of s.matchAll(/\S+/g)) {
      range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r || r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom) continue;
      g.fillText(up ? m[0].toUpperCase() : low ? m[0].toLowerCase() : m[0], r.left - o.left, r.top - o.top + asc);
    }
  }

  function picture(el, x, y, w, h) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'canvas') { if (el.width && el.height) g.drawImage(grabbed.get(el) || el, x, y, w, h); return true; }
    if (tag === 'img') { if (el.complete && el.naturalWidth) g.drawImage(el, x, y, w, h); return true; }
    if (tag === 'svg') {
      const anims = el.getAnimations?.({ subtree: true }) || [];
      if (!anims.length) {
        const key = el.outerHTML + w + 'x' + h + '|' + fontRev;
        const im = images.get(key) || imageOf(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup(el, w, h, false)));
        if (im.complete && im.naturalWidth) g.drawImage(im, x, y, w, h);
        return true;
      }
      // one that animates: the last copy that loaded is drawn while the next one does, and one more is
      // taken after the last thing stops, which is the picture it rests on
      let s = moving.get(el);
      if (!s) moving.set(el, s = { im: null, next: null, at: 0, was: true, key: '' });
      const now = performance.now(), run = anims.some((a) => a.playState === 'running'), key = `${w}x${h}|${fontRev}`;
      if (!s.next && (key !== s.key || ((run || s.was) && now - s.at >= SVG_MS))) {
        s.key = key; s.at = now; s.was = run;
        const im = s.next = new Image();
        im.onload = () => { s.im = im; s.next = null; };
        im.onerror = () => { s.next = null; };
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup(el, w, h, true));
      }
      if (s.im) g.drawImage(s.im, x, y, w, h);
      return true;
    }
    return false;
  }

  function walk(el, cs, alpha) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const a = alpha * px(cs.opacity === '' ? '1' : cs.opacity);
    if (a < 0.01) return;
    const b = el.getBoundingClientRect(), x = b.left - o.left, y = b.top - o.top, w = b.width, h = b.height;
    g.globalAlpha = a;
    if (special?.(el, cs, g, { x, y, w, h })) return;
    box(cs, x, y, w, h);
    if (picture(el, x, y, w, h)) return;
    const clip = cs.overflowX !== 'visible' && w > 0 && h > 0;
    if (clip) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); }
    // what's in the flow first, then what's positioned, by its z-index; a sort keeps document order
    const kids = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3) kids.push({ n, rank: -1e6 });
      else if (n.nodeType === 1) { const c = getComputedStyle(n), z = parseInt(c.zIndex, 10); kids.push({ n, c, rank: c.position === 'static' ? -1e6 : z || 0 }); }
    }
    kids.sort((p, q) => p.rank - q.rank);
    for (const k of kids) {
      g.globalAlpha = a;
      if (k.c) walk(k.n, k.c, a); else words(k.n, cs);
    }
    if (clip) g.restore();
  }

  return {
    paint() {
      o = root.getBoundingClientRect();
      if (!o.width) return false;
      g.setTransform(canvas.width / o.width, 0, 0, canvas.height / o.height, 0, 0);
      g.globalAlpha = 1;
      g.fillStyle = '#000';
      g.fillRect(0, 0, o.width, o.height);
      g.textBaseline = 'alphabetic';
      walk(root, getComputedStyle(root), 1);
      return true;
    },
    // Keep a frame of each canvas under `el`, called while it's still in the drawing buffer.
    grab(el) {
      for (const c of el.querySelectorAll('canvas')) {
        if (!c.width || !c.height) continue;
        let k = grabbed.get(c);
        if (!k || k.width !== c.width || k.height !== c.height) { k = document.createElement('canvas'); k.width = c.width; k.height = c.height; grabbed.set(c, k); }
        // (cleared first: a HUD canvas is see-through, so a copy laid on the last one keeps every old frame)
        const kg = k.getContext('2d'); kg.clearRect(0, 0, k.width, k.height); kg.drawImage(c, 0, 0);
      }
    },
  };
}
