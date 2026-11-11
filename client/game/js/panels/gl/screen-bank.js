// A BANK OF STUDIO SCREENS. The booth set's wall of displays (set-mesh.js `screen_bank`) shows the live
// picture as one texture: an atlas, each screen a cell of it. This paints the atlas, a cell at a time, by what
// the show asks each screen to show: its logo, its title, a weather map of the Basin, the temperature, the
// clock, a ticker, or the brand along the top. A show picks per screen (`screens` on the set, the sequence or
// a beat: { main, left, right, ticker, header }), so one booth serves the weather, the news and anything
// else that wants a wall of screens behind somebody.

export const BANK_ATLAS = [2048, 1536];
// Where each screen sits in the atlas, in pixels, its shape matching the screen's own.
export const BANK_CELLS = {
  main: [0, 0, 1280, 704],
  left: [1280, 0, 384, 640],
  right: [1664, 0, 384, 640],
  header: [0, 1300, 2048, 74],
  ticker: [0, 1400, 2048, 130],
};
export const BANK_DEFAULT = { main: 'title', left: 'logo', right: 'clock', header: 'brand', ticker: 'ticker' };

const cells = new Map();
const cellCanvas = (name, w, h) => {
  let c = cells.get(name);
  if (!c || c.width !== w || c.height !== h) { c = document.createElement('canvas'); c.width = w; c.height = h; cells.set(name, c); }
  return c;
};
const hexRgb = (hex) => { const n = parseInt(String(hex || '#39a0ff').replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const shade = (rgb, k) => rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
const FACE = "'Arial Black', 'Helvetica Neue', Arial, sans-serif", BODY = "'Helvetica Neue', Arial, sans-serif";

// a wordmark fitted to a width: each line as big as it can be
function fitText(c, text, maxW, size, weight = '900', face = FACE) {
  c.font = `${weight} ${size}px ${face}`;
  const w = c.measureText(text).width;
  if (w > maxW) { size = Math.floor((size * maxW) / w); c.font = `${weight} ${size}px ${face}`; }
  return size;
}
function backdrop(c, w, h, rgb) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, rgba(shade(rgb, 0.32))); g.addColorStop(0.55, rgba(shade(rgb, 0.12))); g.addColorStop(1, '#05070b');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // the scanlines a screen in a studio always has on camera
  c.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
}

function paintLogo(c, w, h, brand, show) {
  const rgb = hexRgb(brand.colour);
  backdrop(c, w, h, rgb);
  // speed stripes behind the mark
  c.save(); c.translate(w / 2, h / 2); c.rotate(-0.42);
  for (let i = -6; i <= 6; i++) { c.fillStyle = rgba(rgb, i % 2 ? 0.16 : 0.08); c.fillRect(-w, i * h * 0.09, w * 2, h * 0.045); }
  c.restore();
  const words = String(brand.name || show || '').toUpperCase().split(/\s+/).filter(Boolean);
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words;
  const pad = w * 0.1, lh = Math.min(h * 0.22, (h * 0.62) / Math.max(1, lines.length));
  let y = h / 2 - (lh * lines.length) / 2 + lh * 0.82;
  c.textAlign = 'center';
  for (const line of lines) {
    const size = fitText(c, line, w - pad * 2, lh * 1.05);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(4, size * 0.12); c.strokeStyle = rgba(shade(rgb, 0.35)); c.strokeText(line, w / 2, y);
    c.shadowColor = rgba(rgb, 0.9); c.shadowBlur = size * 0.35;
    c.fillStyle = '#ffffff'; c.fillText(line, w / 2, y);
    c.shadowBlur = 0;
    y += lh;
  }
  // the station's bug in the corner
  const bug = String(show || '').toUpperCase();
  fitText(c, bug, w - pad * 1.2, Math.round(h * 0.045), '700', BODY); c.textAlign = 'right'; c.fillStyle = rgba(rgb, 0.95);
  c.fillText(bug, w - pad * 0.6, h - h * 0.05);
}

function paintTitle(c, w, h, brand, title, sub) {
  const rgb = hexRgb(brand.colour);
  backdrop(c, w, h, rgb);
  c.fillStyle = rgba(rgb, 0.9); c.fillRect(0, h * 0.7, w, h * 0.012);
  c.textAlign = 'left';
  const size = fitText(c, String(title || '').toUpperCase(), w * 0.86, h * 0.17);
  c.fillStyle = '#ffffff'; c.shadowColor = rgba(rgb, 0.8); c.shadowBlur = size * 0.3;
  c.fillText(String(title || '').toUpperCase(), w * 0.07, h * 0.62); c.shadowBlur = 0;
  if (sub) { fitText(c, sub, w * 0.86, h * 0.07, '500', BODY); c.fillStyle = 'rgba(230,236,245,0.9)'; c.fillText(sub, w * 0.07, h * 0.82); }
}

// A forecaster's map of the Basin: water and land in flat tones, Coldwater marked, the day's sky drawn over
// it as a band of rain or snow, cloud or sun, and the temperatures in bubbles. Not the real map: the look of
// one, which is what a weather wall is.
function paintWeather(c, w, h, brand, d) {
  const rgb = hexRgb(brand.colour), sky = String(d.sky || d.weather || 'clear').toLowerCase(), t = Math.round(+(d.tempC ?? d.temp ?? 4));
  c.fillStyle = '#0b2a44'; c.fillRect(0, 0, w, h);
  // the sea's swell, then the land: a coast that bites in for the Basin
  c.strokeStyle = 'rgba(120,180,230,0.12)'; c.lineWidth = 2;
  for (let y = 20; y < h; y += 26) { c.beginPath(); for (let x = 0; x <= w; x += 40) c.lineTo(x, y + 6 * Math.sin(x * 0.02 + y)); c.stroke(); }
  c.fillStyle = '#3c5a34';
  c.beginPath(); c.moveTo(0, h * 0.12); c.bezierCurveTo(w * 0.22, h * 0.05, w * 0.34, h * 0.32, w * 0.42, h * 0.3);
  c.bezierCurveTo(w * 0.5, h * 0.5, w * 0.38, h * 0.62, w * 0.47, h * 0.78); c.bezierCurveTo(w * 0.55, h * 0.95, w * 0.7, h * 0.7, w * 0.78, h * 0.86);
  c.lineTo(w, h * 0.8); c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
  c.fillStyle = '#4d6b40';
  c.beginPath(); c.moveTo(w * 0.62, 0); c.bezierCurveTo(w * 0.7, h * 0.18, w * 0.86, h * 0.1, w, h * 0.22); c.lineTo(w, 0); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 4; c.stroke();
  // the day's sky over it
  const wet = /rain|storm|drizzle|shower/.test(sky), snow = /snow|sleet|ice/.test(sky), cloud = wet || snow || /cloud|overcast|fog|grey/.test(sky);
  if (cloud) {
    c.fillStyle = wet ? 'rgba(40,200,90,0.32)' : snow ? 'rgba(220,235,255,0.35)' : 'rgba(200,205,215,0.25)';
    c.beginPath(); c.ellipse(w * 0.46, h * 0.42, w * 0.38, h * 0.22, -0.35, 0, Math.PI * 2); c.fill();
    if (wet) { c.fillStyle = 'rgba(250,210,40,0.38)'; c.beginPath(); c.ellipse(w * 0.5, h * 0.4, w * 0.16, h * 0.09, -0.35, 0, Math.PI * 2); c.fill(); }
    // a front coming in, triangles and all
    c.strokeStyle = '#2a6fff'; c.lineWidth = 7; c.beginPath();
    for (let i = 0; i <= 10; i++) { const x = w * (0.12 + i * 0.075), y = h * (0.82 - i * 0.06) + 12 * Math.sin(i); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); c.fillStyle = '#2a6fff';
    for (let i = 1; i < 10; i += 2) { const x = w * (0.12 + i * 0.075), y = h * (0.82 - i * 0.06) + 12 * Math.sin(i); c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x + 16, y); c.lineTo(x, y - 26); c.closePath(); c.fill(); }
  } else {
    const sx = w * 0.7, sy = h * 0.3;
    c.fillStyle = 'rgba(255,210,60,0.95)'; c.beginPath(); c.arc(sx, sy, h * 0.08, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,210,60,0.9)'; c.lineWidth = 8;
    for (let a = 0; a < 8; a++) { const k = (a / 8) * Math.PI * 2; c.beginPath(); c.moveTo(sx + Math.cos(k) * h * 0.11, sy + Math.sin(k) * h * 0.11); c.lineTo(sx + Math.cos(k) * h * 0.15, sy + Math.sin(k) * h * 0.15); c.stroke(); }
  }
  // the city and the temperatures
  const bubble = (x, y, v, big) => {
    const r = big ? h * 0.085 : h * 0.06;
    c.fillStyle = v <= 0 ? '#2a6fff' : v < 10 ? '#1aa0a0' : v < 20 ? '#e0a020' : '#e04020';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = `900 ${Math.round(r * 1.05)}px ${FACE}`; c.fillText(`${v}°`, x, y + r * 0.38);
  };
  c.fillStyle = '#fff'; c.beginPath(); c.arc(w * 0.44, h * 0.62, 9, 0, Math.PI * 2); c.fill();
  c.font = `800 ${Math.round(h * 0.05)}px ${BODY}`; c.textAlign = 'left'; c.fillText('COLDWATER', w * 0.44 + 18, h * 0.62 + 10);
  bubble(w * 0.33, h * 0.5, t, true);
  bubble(w * 0.62, h * 0.18, t - 3, false);
  bubble(w * 0.84, h * 0.72, t + 2, false);
  bubble(w * 0.16, h * 0.88, t - 1, false);
  // the brand along the top
  c.fillStyle = rgba(rgb, 0.92); c.fillRect(0, 0, w, h * 0.1);
  c.fillStyle = '#fff'; c.textAlign = 'left'; fitText(c, `${String(brand.name || 'WEATHER').toUpperCase()}  ·  THE BASIN`, w * 0.9, h * 0.065); c.fillText(`${String(brand.name || 'WEATHER').toUpperCase()}  ·  THE BASIN`, w * 0.03, h * 0.075);
}

function paintTemps(c, w, h, brand, d) {
  const rgb = hexRgb(brand.colour), t = Math.round(+(d.tempC ?? d.temp ?? 4)), sky = String(d.sky || d.weather || 'clear');
  backdrop(c, w, h, rgb);
  c.textAlign = 'center'; c.fillStyle = '#fff';
  fitText(c, `${t}°`, w * 0.86, h * 0.3); c.shadowColor = rgba(rgb, 0.9); c.shadowBlur = 30; c.fillText(`${t}°`, w / 2, h * 0.42); c.shadowBlur = 0;
  fitText(c, sky.toUpperCase(), w * 0.86, h * 0.07, '800', BODY); c.fillStyle = rgba(rgb); c.fillText(sky.toUpperCase(), w / 2, h * 0.54);
  const hi = d.hi ?? t + 3, lo = d.lo ?? t - 4;
  c.fillStyle = '#fff'; fitText(c, `HI ${hi}°   LO ${lo}°`, w * 0.86, h * 0.06, '700', BODY); c.fillText(`HI ${hi}°   LO ${lo}°`, w / 2, h * 0.68);
  if (d.wind != null) { fitText(c, `WIND ${d.wind} KM/H`, w * 0.86, h * 0.05, '600', BODY); c.fillStyle = 'rgba(220,230,240,0.85)'; c.fillText(`WIND ${d.wind} KM/H`, w / 2, h * 0.8); }
}

function paintClock(c, w, h, brand, d) {
  const rgb = hexRgb(brand.colour);
  backdrop(c, w, h, rgb);
  const now = new Date(), time = d.time || `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`, day = d.day || now.toLocaleDateString('en-GB', { weekday: 'long' });
  c.textAlign = 'center'; c.fillStyle = '#fff';
  fitText(c, String(time), w * 0.86, h * 0.22); c.fillText(String(time), w / 2, h * 0.45);
  fitText(c, String(day).toUpperCase(), w * 0.86, h * 0.07, '800', BODY); c.fillStyle = rgba(rgb); c.fillText(String(day).toUpperCase(), w / 2, h * 0.58);
  c.fillStyle = rgba(rgb, 0.85); c.fillRect(w * 0.2, h * 0.66, w * 0.6, 6);
  fitText(c, 'LIVE', w * 0.5, h * 0.06, '900'); c.fillStyle = '#ff3030'; c.fillText('● LIVE', w / 2, h * 0.78);
}

function paintHeader(c, w, h, brand, show) {
  const rgb = hexRgb(brand.colour), g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, rgba(shade(rgb, 0.5))); g.addColorStop(0.5, rgba(rgb)); g.addColorStop(1, rgba(shade(rgb, 0.5)));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#fff'; c.textAlign = 'center'; fitText(c, `${String(brand.name || '').toUpperCase()}   ·   ${String(show || '').toUpperCase()}`, w * 0.9, h * 0.62);
  c.fillText(`${String(brand.name || '').toUpperCase()}   ·   ${String(show || '').toUpperCase()}`, w / 2, h * 0.74);
}

function paintTicker(c, w, h, brand, text, now) {
  const rgb = hexRgb(brand.colour);
  c.fillStyle = '#0a0d12'; c.fillRect(0, 0, w, h);
  c.fillStyle = rgba(rgb); c.fillRect(0, 0, h * 2.4, h);
  c.fillStyle = '#fff'; c.textAlign = 'center'; fitText(c, String(brand.name || 'NEWS').toUpperCase().split(' ')[0], h * 2.2, h * 0.5); c.fillText(String(brand.name || 'NEWS').toUpperCase().split(' ')[0], h * 1.2, h * 0.68);
  c.save(); c.beginPath(); c.rect(h * 2.4, 0, w - h * 2.4, h); c.clip();
  c.font = `700 ${Math.round(h * 0.46)}px ${BODY}`; c.textAlign = 'left'; c.fillStyle = '#f2f4f8';
  const line = `${String(text).toUpperCase()}      ●      `, lw = c.measureText(line).width || 1, x0 = h * 2.4 - ((now / 1000) * 140) % lw;
  for (let x = x0; x < w; x += lw) c.fillText(line, x, h * 0.66);
  c.restore();
}

// Paint the whole atlas. `screens` says what each screen shows; `d` is the show's data (the forecast's
// numbers, the time); `title`/`sub` the show's own words; `ticker` the crawl. Returns whether anything moves,
// so the caller knows to keep repainting (a ticker crawls, a clock ticks).
export function paintBank(canvas, { screens = {}, brand = {}, show = '', title = '', sub = '', ticker = '', d = {}, now = 0 } = {}) {
  if (canvas.width !== BANK_ATLAS[0] || canvas.height !== BANK_ATLAS[1]) { canvas.width = BANK_ATLAS[0]; canvas.height = BANK_ATLAS[1]; }
  const ctx = canvas.getContext('2d'), want = { ...BANK_DEFAULT, ...screens };
  let moves = false;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [name, [x, y, w, h]] of Object.entries(BANK_CELLS)) {
    const kind = want[name];
    if (!kind) continue;
    const cv = cellCanvas(name, w, h), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); c.textBaseline = 'alphabetic';
    if (kind === 'logo') paintLogo(c, w, h, brand, show);
    else if (kind === 'weather') paintWeather(c, w, h, brand, d);
    else if (kind === 'temps') paintTemps(c, w, h, brand, d);
    else if (kind === 'clock') { paintClock(c, w, h, brand, d); moves = true; }
    else if (kind === 'brand') paintHeader(c, w, h, brand, show);
    else if (kind === 'ticker') { paintTicker(c, w, h, brand, ticker || `${show}  ·  ${sub || title}`, now); moves = true; }
    else paintTitle(c, w, h, brand, title || show, sub);
    ctx.drawImage(cv, x, y);
  }
  return moves;
}
