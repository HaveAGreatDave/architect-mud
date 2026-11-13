// PRECIP LOOK: what falling weather looks like, for every renderer that draws it.
//
// One answer to "how big is a raindrop, what colour is it in this light, how many are there": the
// room-pane overlay (weather-fx.js), the windscreen (windshield.js) and the hangar and helipad
// backdrops (aircraft3d.js) all read it, so a change to size or colour reaches every view at once.
// Before this file each drew its own rain with its own numbers, and they had drifted apart.
//
// Two layers:
//   - The model: pure functions and constants, no DOM. `precipKind`, `rainRGB`, `rainLit`,
//     `dropSize`, `GLINT_SHARE` and the colours. A GL view can take its numbers from here too.
//   - 2D painters for the backdrops that draw weather as a stateless picture (hashed from an index
//     and the clock): `paintRain2D`, `paintSnow2D`, `paintFogBand`, `paintFlash2D`. The overlay
//     and the windscreen keep their own particle pools (depth, splashes, lamp census) and take
//     only the model.
//
// `light` everywhere is 0 (night, or underground) to 1 (noon). Rain is only seen by the light
// on it: pale by day, dim at night, and after dark a share of the near drops lit warm by lamps.
// Lightning lives in shared/lightning.js and lightning-draw.js; ground wetness in ground-accum.js.

import { SNOW_PTYPES } from './ground-accum.js';

// ── COLOURS (sRGB 0..255) ───────────────────────────────────────────────────────────────────────
export const RAIN_DAY = Object.freeze([178, 203, 235]);
export const RAIN_NIGHT = Object.freeze([98, 108, 132]);
export const RAIN_ON_LIGHT_BG = Object.freeze([54, 88, 132]);   // a light UI theme behind the overlay
export const LAMP_RGB = Object.freeze([255, 196, 128]);          // sodium lamp
export const SNOW_RGB = Object.freeze([240, 246, 253]);
export const SNOW_NIGHT = Object.freeze([150, 158, 176]);
export const ASH_RGB = Object.freeze([200, 140, 90]);
export const FOG_RGB = Object.freeze([198, 204, 212]);
export const FLASH_RGB = Object.freeze([222, 232, 255]);
export const ACID_RGB = Object.freeze([176, 214, 120]);          // acid rain's sick green

// Share of the nearer drops that pass through lamplight after dark.
export const GLINT_SHARE = 0.18;

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const mix = (a, b, k) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));

// What falls, from a precip type (`sky.here.precipType`, a cell's type) or a weather word.
// Returns 'rain' | 'snow' | 'ash' | null. Sleet is snow, as the ground counts it (SNOW_PTYPES).
export function precipKind(type) {
  const t = String(type || '');
  if (!t || t === 'none') return null;
  if (SNOW_PTYPES.has(t)) return 'snow';
  if (t === 'ash' || t === 'dust') return 'ash';
  if (/rain|storm|drizzle|acid|shower/.test(t)) return 'rain';
  return null;
}

// The rain's colour in this light.
export function rainRGB(light, { acid = false } = {}) {
  const c = mix(RAIN_NIGHT, RAIN_DAY, clamp01(light));
  return acid ? mix(c, ACID_RGB, 0.55) : c;
}
// How strongly rain shows: dim drops are harder to see, but never gone.
export const rainLit = (light) => 0.7 + 0.3 * clamp01(light);
// How much of the lamp glint shows: none by day, all of it at night.
export const glintAmount = (light) => 1 - clamp01(light);
export const snowRGB = (light) => mix(SNOW_NIGHT, SNOW_RGB, clamp01(light));

// A drop's streak at depth z (0 far, 1 near the eye) and intensity I (0..1), in CSS pixels on a
// pane about 600 px tall; pass `scale` for other sizes. Length follows speed, which is what makes
// heavy rain look heavier; width stays thin, because a real drop is a millimetre or two.
export function dropSize(z, I, scale = 1) {
  const zz = clamp01(z), ii = clamp01(I);
  return { len: (5 + 17 * zz) * (0.75 + 0.6 * ii) * scale, wid: (0.5 + 1.0 * zz) * Math.sqrt(scale) };
}

// ── 2D SPRITES ──────────────────────────────────────────────────────────────────────────────────
// A falling drop is a streak faint at the tail and solid at the head. 8×64, head at the bottom.
// Cached by colour; returns null with no DOM.
const SPRITES = new Map();
export function dropSprite(rgb, { head = 0.35 } = {}) {
  const key = rgb.join(',') + '|' + head;
  if (SPRITES.has(key)) return SPRITES.get(key);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext && c.getContext('2d');
  if (!g || !g.createLinearGradient) return null;
  const s = rgb.join(',');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, `rgba(${s},0)`);
  grad.addColorStop(0.55, `rgba(${s},0.35)`);
  grad.addColorStop(0.9, `rgba(${s},0.9)`);
  grad.addColorStop(1, `rgba(${s},1)`);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(3.6, 0); g.lineTo(4.4, 0);
  g.lineTo(7, 58); g.quadraticCurveTo(4, 66, 1, 58);
  g.closePath(); g.fill();
  if (head > 0) {
    g.fillStyle = `rgba(255,255,255,${head})`;
    g.beginPath(); g.ellipse(4, 59, 1.6, 3, 0, 0, Math.PI * 2); g.fill();
  }
  if (SPRITES.size > 32) SPRITES.clear();
  SPRITES.set(key, c);
  return c;
}
export const glintSprite = () => dropSprite(LAMP_RGB, { head: 0.5 });

// ── STATELESS 2D PAINTERS ───────────────────────────────────────────────────────────────────────
const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Rain over a rectangle, from the clock alone. `rate` 0..1, `windKph` leans it, `light` colours it.
// `ground` (a y in the rect) adds splash rings on the band below it. `scale` as in dropSize.
export function paintRain2D(ctx, { x = 0, y = 0, w, h, t, rate = 0.5, windKph = 0, light = 1, acid = false, ground = null, groundBot = null, scale = 1, count = null }) {
  if (!(w > 0 && h > 0)) return;
  const I = clamp01(rate);
  const n = count ?? Math.round((60 + 110 * I) * Math.max(0.4, (w * h) / 150000));
  const lean = 0.12 + Math.min(0.5, windKph / 90);
  const col = rainRGB(light, { acid }), lit = rainLit(light), glint = glintAmount(light);
  const spr = dropSprite(col), gspr = glint > 0.05 ? glintSprite() : null;
  const a0 = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    const z = hash01(i * 4.1) ** 2;
    const { len, wid } = dropSize(z, I, scale);
    const speed = (0.9 + 1.4 * z) * (0.7 + 0.5 * I);
    const fy = (hash01(i * 2.7) + t * speed) % 1;
    const py = y + fy * (h + len);
    // Wind carries a drop right as it falls; start it far enough left to cross the whole rect.
    const span = w + h * lean;
    const px = x - h * lean + (hash01(i * 1.3) * span + fy * h * lean) % span;
    const a = Math.min(1, (0.45 + 0.6 * z) * lit);
    const cs = 1 / Math.hypot(1, lean), sn = lean * cs;
    if (spr) {
      ctx.save();
      ctx.transform(cs, -sn, sn, cs, px, py);   // the tail trails up and upwind
      ctx.globalAlpha = a0 * a;
      ctx.drawImage(spr, -wid / 2, -len, wid, len);
      if (gspr && z > 0.3 && hash01(i * 9.7) < GLINT_SHARE) { ctx.globalAlpha = a0 * a * glint; ctx.drawImage(gspr, -wid / 2, -len, wid, len); }
      ctx.restore();
    } else {
      ctx.strokeStyle = rgba(col, a); ctx.lineWidth = wid;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - len * sn, py - len * cs); ctx.stroke();
    }
  }
  ctx.globalAlpha = a0;
  if (ground != null) {
    const bot = groundBot ?? y + h;
    const rings = Math.round(4 + 6 * I);
    ctx.strokeStyle = rgba(col, 0.3 * lit);
    ctx.lineWidth = 0.8;
    for (let i = 0; i < rings; i++) {
      const sx = x + hash01(i * 3.7) * w, sy = ground + hash01(i * 6.1) * (bot - ground) * 0.8;
      const k = (t * 1.7 + i * 0.37) % 1, r = (0.8 + k * 3.5) * scale;
      ctx.globalAlpha = a0 * (1 - k);
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = a0;
  }
}

// Snow over a rectangle. Rate and wind make it a blizzard: thicker, slanted, behind a white veil.
export function paintSnow2D(ctx, { x = 0, y = 0, w, h, t, rate = 0.5, windKph = 0, light = 1, veil = true, scale = 1 }) {
  if (!(w > 0 && h > 0)) return;
  const bliz = Math.max(clamp01(rate) * 0.6, Math.min(1, windKph / 45));
  const col = snowRGB(light);
  if (veil) { ctx.fillStyle = rgba(col, 0.05 + bliz * 0.35); ctx.fillRect(x, y, w, h); }
  const slant = (2 + bliz * 16) * scale, fall = 0.08 + bliz * 0.12;
  const n = Math.round((20 + 40 * bliz) * Math.max(0.5, (w * h) / 180000));
  ctx.fillStyle = rgba(col, 0.85);
  for (let i = 0; i < n; i++) {
    const z = hash01(i * 5.3);
    const ny = (hash01(i * 3.1) + t * fall * (0.6 + z)) % 1;
    const sway = Math.sin(t * 1.3 + i) * 3 * scale;
    const px = x + ((hash01(i * 1.7) * w + ny * slant + sway) % w + w) % w, py = y + ny * h;
    ctx.beginPath(); ctx.arc(px, py, (0.8 + 1.2 * z) * scale, 0, Math.PI * 2); ctx.fill();
  }
}

// A band of ground haze rising `h` from `yBot`. `amount` 0..1 (fog ~0.4, cloudy ~0.22).
export function paintFogBand(ctx, { x = 0, w, yBot, h, amount = 0.3, light = 1 }) {
  const col = mix([60, 66, 78], FOG_RGB, clamp01(light));   // fog at night is grey, not white
  const g = ctx.createLinearGradient(0, yBot - h, 0, yBot);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, amount));
  ctx.fillStyle = g; ctx.fillRect(x, yBot - h, w, h);
}

// The sky lit by a lightning flash, `flash` 0..1.
export function paintFlash2D(ctx, { x = 0, y = 0, w, h, flash }) {
  if (!(flash > 0.01)) return;
  ctx.fillStyle = rgba(FLASH_RGB, Math.min(0.72, flash * 0.72));
  ctx.fillRect(x, y, w, h);
}
