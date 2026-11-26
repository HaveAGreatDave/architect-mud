// THE TELESCOPE'S STAR CHART: hold C at a telescope whose vantage says `stars` (plugins/freelook standBlock) and the
// constellations are drawn over the sky, their stars, the lines between them and their names.
//
// GLASS's own stars are a procedural field (gl/sky.js starField), so they aren't real stars and the chart can't point
// at them. It brings its own: the bright stars of fourteen constellations by right ascension (hours) and declination
// (degrees), turned to the sky over the Basin for the game's hour and the day of the year, and placed through the
// last frame's own sky camera (windshield.js skyProjectNow), so they sit where that camera would draw them.
import { skyProjectNow, skyHeadingNow, skyMoonNow } from './windshield.js';
import { drawMoonDetail } from './moon-detail.js';   // the moon up close, always at a telescope

const LAT = 43;   // degrees north: the Basin's latitude, as London, Ontario's
const MIN_ALT = 3;   // degrees: lower than this a star is behind the hills on the horizon

// [name, ra h, dec deg, magnitude]; a constellation's lines are pairs of indices into its stars
const SKY = [
  { name: 'Orion', stars: [['Betelgeuse', 5.92, 7.41, 0.5], ['Bellatrix', 5.42, 6.35, 1.6], ['Mintaka', 5.53, -0.30, 2.2], ['Alnilam', 5.60, -1.20, 1.7], ['Alnitak', 5.68, -1.94, 1.8], ['Saiph', 5.80, -9.67, 2.1], ['Rigel', 5.24, -8.20, 0.1], ['Meissa', 5.59, 9.93, 3.4]],
    lines: [[0, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [0, 7], [1, 7]] },
  { name: 'The Plough', stars: [['Dubhe', 11.06, 61.75, 1.8], ['Merak', 11.03, 56.38, 2.4], ['Phecda', 11.90, 53.69, 2.4], ['Megrez', 12.26, 57.03, 3.3], ['Alioth', 12.90, 55.96, 1.8], ['Mizar', 13.40, 54.93, 2.2], ['Alkaid', 13.79, 49.31, 1.9]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] },
  { name: 'Little Bear', stars: [['Polaris', 2.53, 89.26, 2.0], ['Yildun', 17.54, 86.59, 4.4], ['Epsilon UMi', 16.77, 82.04, 4.2], ['Zeta UMi', 15.73, 77.79, 4.3], ['Kochab', 14.85, 74.16, 2.1], ['Pherkad', 15.35, 71.83, 3.0], ['Eta UMi', 16.29, 75.76, 5.0]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  { name: 'Cassiopeia', stars: [['Caph', 0.15, 59.15, 2.3], ['Schedar', 0.68, 56.54, 2.2], ['Navi', 0.95, 60.72, 2.2], ['Ruchbah', 1.43, 60.24, 2.7], ['Segin', 1.91, 63.67, 3.4]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'Cygnus', stars: [['Deneb', 20.69, 45.28, 1.3], ['Sadr', 20.37, 40.26, 2.2], ['Albireo', 19.51, 27.96, 3.1], ['Gienah', 20.77, 33.97, 2.5], ['Fawaris', 19.75, 45.13, 2.9]],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4]] },
  { name: 'Lyra', stars: [['Vega', 18.62, 38.78, 0.0], ['Sheliak', 18.83, 33.36, 3.5], ['Sulafat', 18.98, 32.69, 3.3], ['Zeta Lyr', 18.75, 37.61, 4.3]],
    lines: [[0, 3], [3, 1], [1, 2], [2, 3]] },
  { name: 'Aquila', stars: [['Altair', 19.85, 8.87, 0.8], ['Tarazed', 19.77, 10.61, 2.7], ['Alshain', 19.92, 6.41, 3.7], ['Deneb el Okab', 19.09, 13.86, 3.0], ['Delta Aql', 19.42, 3.11, 3.4]],
    lines: [[1, 0], [0, 2], [0, 4], [1, 3]] },
  { name: 'Scorpius', stars: [['Acrab', 16.09, -19.81, 2.6], ['Dschubba', 16.01, -22.62, 2.3], ['Antares', 16.49, -26.43, 1.0], ['Tau Sco', 16.60, -28.22, 2.8], ['Epsilon Sco', 16.84, -34.29, 2.3], ['Sargas', 17.62, -43.00, 1.9], ['Shaula', 17.56, -37.10, 1.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  { name: 'Leo', stars: [['Regulus', 10.14, 11.97, 1.4], ['Eta Leo', 10.12, 16.76, 3.5], ['Algieba', 10.33, 19.84, 2.0], ['Adhafera', 10.28, 23.42, 3.4], ['Rasalas', 9.88, 26.01, 3.9], ['Zosma', 11.24, 20.52, 2.6], ['Denebola', 11.82, 14.57, 2.1], ['Chertan', 11.24, 15.43, 3.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 7], [7, 0]] },
  { name: 'Taurus', stars: [['Aldebaran', 4.60, 16.51, 0.9], ['Elnath', 5.44, 28.61, 1.7], ['Tianguan', 5.63, 21.14, 3.0], ['Ain', 4.48, 19.18, 3.5], ['Hyadum I', 4.33, 15.63, 3.7], ['Pleiades', 3.79, 24.11, 1.6]],
    lines: [[0, 2], [3, 1], [0, 4], [4, 3], [4, 5]] },
  { name: 'Gemini', stars: [['Castor', 7.58, 31.89, 1.6], ['Pollux', 7.76, 28.03, 1.1], ['Alhena', 6.63, 16.40, 1.9], ['Mebsuta', 6.73, 25.13, 3.0], ['Wasat', 7.34, 21.98, 3.5], ['Tejat', 6.38, 22.51, 2.9]],
    lines: [[0, 3], [3, 5], [1, 4], [4, 2], [0, 1]] },
  { name: 'Canis Major', stars: [['Sirius', 6.75, -16.72, -1.5], ['Mirzam', 6.38, -17.96, 2.0], ['Wezen', 7.14, -26.39, 1.8], ['Adhara', 6.98, -28.97, 1.5], ['Aludra', 7.40, -29.30, 2.4]],
    lines: [[1, 0], [0, 2], [2, 3], [2, 4]] },
  { name: 'Pegasus', stars: [['Markab', 23.08, 15.21, 2.5], ['Scheat', 23.06, 28.08, 2.4], ['Alpheratz', 0.14, 29.09, 2.1], ['Algenib', 0.22, 15.18, 2.8], ['Enif', 21.74, 9.88, 2.4]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]] },
  { name: 'Boötes', stars: [['Arcturus', 14.26, 19.18, -0.1], ['Izar', 14.75, 27.07, 2.4], ['Seginus', 14.53, 38.31, 3.0], ['Nekkar', 15.03, 40.39, 3.5], ['Muphrid', 13.91, 18.40, 2.7]],
    lines: [[4, 0], [0, 1], [1, 3], [3, 2], [2, 0]] },
];

const D2R = Math.PI / 180;
// the sky over the Basin: a star's [azimuth from north, clockwise; altitude] in degrees, for the game's hour and the
// day of the year. Local sidereal time is 0 h at noon on the March equinox and gains about 4 minutes a day.
export function altAz(raH, decDeg, hour, doy) {
  const lst = ((doy - 80) * 0.9856 + (hour - 12) * 15 + 720) % 360;
  const H = (lst - raH * 15) * D2R, d = decDeg * D2R, p = LAT * D2R;
  const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(H));
  return [((az / D2R) + 360) % 360, alt / D2R];
}
const doyNow = () => { const n = new Date(), s = new Date(n.getFullYear(), 0, 0); return Math.floor((n - s) / 86400000); };

// The chart's canvas over the view's: made the first time it's wanted, sized to the view's canvas each frame.
export function createStarChart(host) {
  let cv = null;
  const ensure = (ref) => {
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'star-chart';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
      host.appendChild(cv);
    }
    if (ref && (cv.width !== ref.width || cv.height !== ref.height)) { cv.width = ref.width; cv.height = ref.height; }
    return cv;
  };
  return {
    // `on` whether C is held, `hour` the game's, `ref` the view's own canvas (the chart is laid on in its pixels)
    // The moon is drawn close up whenever it's up at night, C or not: through a telescope you zoom in on it, and
    // GLASS's own is a sprite for a small disc (moon-detail.js). It goes on last, over the chart's dimming.
    draw(on, hour, ref) {
      const moon = skyMoonNow();
      if (!on && !moon) { if (cv) cv.style.display = 'none'; return; }
      const c = ensure(ref), g = c.getContext('2d');
      c.style.display = '';
      g.clearRect(0, 0, c.width, c.height);
      if (!skyProjectNow(0, 45)) return;
      if (on) chart(c, g, hour);
      if (moon) {
        const p = skyProjectNow(moon.az, moon.el);
        if (p && p.front) drawMoonDetail(g, p.sx * c.width / p.W, p.sy * c.height / p.H, moon.R * c.width / p.W, moon.phase, moon.tilt);
      }
    },
    remove() { cv?.remove(); cv = null; },
  };
}

// the constellations, over a dimming of the whole view
function chart(c, g, hour) {
      const doy = doyNow(), k = c.width / 1100;
      // a dimming over the whole view, so the lines read over the city's lights
      g.fillStyle = 'rgba(2,6,18,0.42)';
      g.fillRect(0, 0, c.width, c.height);
      g.lineCap = 'round';
      for (const C of SKY) {
        // Only what's up: a star 3 degrees over the horizon, clear of the hills drawn along it, and a constellation
        // only once two-thirds of its stars have risen, so a half-set one doesn't hang its name in the ground.
        const sky = C.stars.map(([, ra, dec]) => altAz(ra, dec, hour, doy));
        if (sky.filter(([, alt]) => alt >= MIN_ALT).length < Math.ceil(C.stars.length * 2 / 3)) continue;
        const pts = C.stars.map(([, , , mag], i) => {
          const [az, alt] = sky[i];
          if (alt < MIN_ALT) return null;
          // behind you, it isn't in the eyepiece: the sky camera's own test lets a high star behind through when you
          // look up, so anything more than 100 degrees off where you face is left out unless it's near the zenith
          const head = skyHeadingNow();
          if (head != null && alt < 70 && Math.abs(((az - head + 540) % 360) - 180) > 100) return null;
          const p = skyProjectNow(az, alt);
          return p && p.front ? { x: p.sx * c.width / p.W, y: p.sy * c.height / p.H, mag } : null;
        });
        g.strokeStyle = 'rgba(120,220,255,0.55)';
        g.lineWidth = 1.4 * k;
        g.beginPath();
        for (const [a, b] of C.lines) if (pts[a] && pts[b]) { g.moveTo(pts[a].x, pts[a].y); g.lineTo(pts[b].x, pts[b].y); }
        g.stroke();
        const seen = pts.filter(Boolean);
        for (const [i, p] of pts.entries()) {
          if (!p) continue;
          const r = Math.max(1.4, 4.2 - p.mag * 0.8) * k;
          g.fillStyle = 'rgba(255,250,235,0.95)';
          g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
          // the brightest stars by name
          if (p.mag < 1.6 || C.stars[i][0] === 'Polaris') { g.fillStyle = 'rgba(255,240,215,0.6)'; g.font = `italic ${Math.max(9, Math.round(10 * k))}px Georgia, 'Times New Roman', serif`; g.fillText(C.stars[i][0], p.x + r + 3 * k, p.y - r); }
        }
        // the constellation's name: small and light, letter-spaced, under its stars, as an old star atlas sets it
        if (seen.length >= 2) {
          const mx = seen.reduce((s, p) => s + p.x, 0) / seen.length, my = Math.max(...seen.map((p) => p.y));
          g.fillStyle = 'rgba(170,228,255,0.72)';
          g.font = `${Math.max(9, Math.round(10.5 * k))}px Georgia, 'Times New Roman', serif`;
          if ('letterSpacing' in g) g.letterSpacing = `${(2 * k).toFixed(1)}px`;
          g.textAlign = 'center';
          g.fillText(C.name.toUpperCase(), mx, my + 16 * k);
          g.textAlign = 'left';
          if ('letterSpacing' in g) g.letterSpacing = '0px';
        }
      }
      if (hour >= 6.5 && hour <= 18.5) {
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `${Math.round(13 * k)}px sans-serif`; g.textAlign = 'center';
        g.fillText('The chart shows where they are. Come back after dark to see them.', c.width / 2, c.height - 40 * k);
        g.textAlign = 'left';
      }
}
