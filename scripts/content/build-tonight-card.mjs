// The Tonight Show's title card: the poster, with parts of it animated in time with the theme.
//
//   node scripts/content/build-tonight-card.mjs           rewrite the card in both places
//   node scripts/content/build-tonight-card.mjs --check   fail if either is behind this script
//
// The poster itself is untouched: a JPEG already embedded in data/scripts/Tonight_Show.bsm's
// `::asset tonight_show_logo`. This script reads it back out of that block, lays animated
// shapes over it, and writes the result to the .bsm and to content/media_graphics/
// tonight_show_logo.json (build-tonight-show.mjs only rewrites the broadcast's pools, so the
// graphic row needs writing here).
//
// TIMING. Every delay is a bar and row of the theme (scripts/content/build-tonight-theme.mjs),
// so the card hits when the band does. The tv panel inserts the card as the theme starts, and
// CSS animations start on insertion. What moves, by bar:
//   1      the studio is dark; the neon ring draws itself round the sign
//   2      THE HIT: the lights come up, the sign strikes, the camera punches in
//   3      the LIVE FROM THE FUTURE board flickers on; traffic crosses the sky; the ring
//          pulses on the beat from here; windows twinkle in the towers
//   7      the 2107 sign comes on; searchlights start to sweep
//   11     the shout stabs blink the board, three times in 3-3-2
//   13     the last chord: a flash, and the audience's cameras go off
//   14     the button: one more flash and a punch
//
// Rules for what goes in the markup: no `{word}` but `{year}` (the broadcast runner substitutes
// those as tokens, and `year` is the in-game year on the sign), class names prefixed `tsx-` because a <style> in inline SVG is global to the
// page, and everything stops under prefers-reduced-motion.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import * as THEME_1 from './build-tonight-theme.mjs';
import * as THEME_2 from './build-tonight-theme-2.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');
// --print <theme>: write the card timed to that theme to stdout and touch no files (previews).
const PRINT = process.argv.includes('--print') ? process.argv[process.argv.indexOf('--print') + 1] : null;
const BSM = 'data/scripts/Tonight_Show.bsm';
const ROW_JSON = 'content/media_graphics/tonight_show_logo.json';
// The card is timed to whichever theme the show's `@theme` names. Both themes share the same
// bar landmarks (the hit on bar 2, the shout on 11, the button on beat four of 14), so only
// the bar's length differs.
const THEMES = { [THEME_1.SONG_NAME]: THEME_1, [THEME_2.SONG_NAME]: THEME_2 };
const themeName = PRINT || /^@theme\s+"?([\w ]+?)"?\s*$/m.exec(fs.readFileSync(path.join(ROOT, BSM), 'utf8'))?.[1];
if (!THEMES[themeName]) throw new Error(`${BSM}: @theme '${themeName}' isn't a theme this card knows (${Object.keys(THEMES).join(', ')})`);
const BAR_SEC = THEMES[themeName].BAR_SEC;

// By eye off the poster: the studio window (the skyline, right of the wall the sign hangs on,
// down to the stage), and John's head and shoulders in front of it. The sky's moving parts are
// drawn inside the one and never over the other.
const SKY = { x: 358, bottom: 470 };
// The window's black bars, measured off the poster's pixels (x, y, w, h): the upright left of
// the glass and its crossbar, the one at the top right, and the frame's right edge. The sky's
// moving parts go behind them.
const BARS = [[386, 0, 20, 130], [354, 50, 54, 16], [730, 0, 17, 88], [754, 0, 6, 470]];
const MAN = '345,190 380,125 450,98 530,108 588,168 598,250 575,330 545,372 525,402 642,440 652,520 138,520 198,440 318,400 328,300 298,258';
// The poster's two flying cars, by eye: the box each is cut from (x, y, w, h), the sky it's
// patched with where it was parked (top, bottom), how far it flies off (out: past the wall at
// SKY.x, or off the right edge) and where it comes back in from (back), and the bar it sets off.
// The car itself flies as a cut-out PNG with its sky made transparent (cut-tonight-cars.ps1
// makes data/scripts/tonight-card/car-<k>.png from these boxes), so it carries no sky with it.
const CARS = {
  l: { box: [440, 22, 78, 48], sky: ['#001558', '#001558'], out: -160, back: 322, bar: 3 },
  r: { box: [583, 28, 122, 64], sky: ['#011250', '#011250'], out: 178, back: -347, bar: 4 },
};
const carPng = (k) => fs.readFileSync(path.join(ROOT, `data/scripts/tonight-card/car-${k}.png`)).toString('base64');
const t = (bar, row = 0) => +(((bar - 1) * BAR_SEC) + row * BAR_SEC / 16).toFixed(3);
const BEAT = +(BAR_SEC / 4).toFixed(4);
const s = (x) => `${x}s`;

// ── the poster, out of the .bsm ─────────────────────────────────────────────
const bsm = fs.readFileSync(path.join(ROOT, BSM), 'utf8');
const NL = bsm.includes('\r\n') ? '\r\n' : '\n';
const lines = bsm.split(/\r?\n/);
const at = lines.findIndex((l) => l.trim() === '::asset tonight_show_logo');
if (at < 0 || lines[at + 2]?.trim() !== '::endasset') throw new Error(`${BSM}: no one-line ::asset tonight_show_logo block`);
const jpeg = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(lines[at + 1])?.[1];
if (!jpeg) throw new Error(`${BSM}: the tonight_show_logo asset has no embedded JPEG`);

// ── the overlay ─────────────────────────────────────────────────────────────
// Windows in the towers on the right, by eye off the poster: x, y, w, h, the bar they first
// light in, and their blink period in beats.
const WINDOWS = [
  [604, 196, 5, 7, 3, 3], [612, 238, 5, 7, 4, 5], [598, 290, 5, 7, 3, 7], [646, 214, 4, 6, 5, 4],
  [652, 262, 4, 6, 3, 6], [640, 318, 4, 6, 6, 3], [574, 344, 5, 6, 4, 5], [588, 382, 5, 6, 5, 7],
  [544, 300, 4, 6, 7, 4], [552, 360, 4, 6, 3, 6], [666, 372, 4, 6, 7, 5], [622, 400, 5, 6, 6, 3],
  [560, 120, 3, 5, 4, 8], [566, 92, 3, 5, 8, 6],
];
// Audience cameras on the last chord: x, y and the row of bar 13/14 they go off on.
const FLASHES = [[110, 470, 13, 2], [230, 500, 13, 6], [680, 480, 13, 9], [40, 430, 13, 13], [620, 505, 14, 1], [170, 445, 14, 5], [720, 440, 14, 8]];

const css = [
  `.tsx-cam{transform-origin:380px 260px;animation:tsx-cam-in ${s(t(2))} cubic-bezier(.2,.7,.2,1) both,tsx-punch .45s ease-out ${s(t(2))},tsx-punch .5s ease-out ${s(t(13))},tsx-punch .6s ease-out ${s(t(14, 12))}}`,
  `@keyframes tsx-cam-in{from{transform:scale(1.09) translate(-14px,6px)}to{transform:scale(1)}}`,
  `@keyframes tsx-punch{0%{transform:scale(1)}25%{transform:scale(1.035)}100%{transform:scale(1)}}`,
  // the studio before the hit, and the sign's tubes striking after it
  `.tsx-dark{animation:tsx-lights .5s steps(1,end) ${s(t(2) - 0.12)} both}`,
  `@keyframes tsx-lights{0%{opacity:.78}30%{opacity:.2}45%{opacity:.6}60%{opacity:.1}100%{opacity:0}}`,
  `.tsx-signoff{animation:tsx-strike .9s linear ${s(t(2))} both}`,
  `@keyframes tsx-strike{0%{opacity:.85}10%{opacity:.1}18%{opacity:.7}26%{opacity:0}40%{opacity:.45}48%{opacity:0}100%{opacity:0}}`,
  // the ring draws on through bar 1, then breathes on every beat from bar 3
  `.tsx-ring{stroke-dasharray:1060;stroke-dashoffset:1060;animation:tsx-draw ${s(t(2) - 0.1)} ease-in-out .15s forwards,tsx-beat ${s(BEAT)} ease-out ${s(t(3))} infinite}`,
  `@keyframes tsx-draw{to{stroke-dashoffset:0}}`,
  `@keyframes tsx-beat{0%{opacity:1;stroke-width:9}100%{opacity:.35;stroke-width:5}}`,
  `.tsx-halo{opacity:0;animation:tsx-halo ${s(BEAT * 2)} ease-in-out ${s(t(2))} infinite alternate}`,
  `@keyframes tsx-halo{from{opacity:.12}to{opacity:.38}}`,
  // the board on the right
  `.tsx-board{animation:tsx-board-on .8s linear ${s(t(3))} both,tsx-stab .16s linear ${s(t(11))},tsx-stab .16s linear ${s(t(11, 6))},tsx-stab .16s linear ${s(t(11, 12))}}`,
  `@keyframes tsx-board-on{0%{opacity:.85}15%{opacity:.2}25%{opacity:.85}45%{opacity:0}55%{opacity:.5}70%{opacity:0}100%{opacity:0}}`,
  `@keyframes tsx-stab{0%{opacity:.7}100%{opacity:0}}`,
  `.tsx-planet{opacity:0;animation:tsx-halo ${s(BEAT * 4)} ease-in-out ${s(t(3))} infinite alternate}`,
  `.tsx-year{opacity:0;animation:tsx-year-on .7s linear ${s(t(7))} forwards}`,
  `@keyframes tsx-year-on{0%{opacity:0}15%{opacity:.8}25%{opacity:.1}45%{opacity:1}55%{opacity:.4}70%{opacity:1}100%{opacity:1}}`,
  // traffic: lights crossing the sky, one each way, from bar 3
  `.tsx-car{opacity:0;animation:tsx-fly 9s linear infinite}`,
  `.tsx-car.a{animation-delay:${s(t(3))}}.tsx-car.b{animation-delay:${s(t(5))};animation-direction:reverse}.tsx-car.c{animation-delay:${s(t(8))};animation-duration:6.5s}`,
  `@keyframes tsx-fly{0%{opacity:0;transform:translate(0,0)}6%{opacity:1}94%{opacity:1}100%{opacity:0;transform:translate(820px,-26px)}}`,
  `.tsx-hover{animation:tsx-bob ${s(BEAT * 4)} ease-in-out infinite alternate}`,
  `@keyframes tsx-bob{from{transform:translateY(-2px);opacity:.5}to{transform:translateY(3px);opacity:.9}}`,
  // the poster's two flying cars, from bar 3: each flies off its own side, behind the wall or
  // off the edge, and comes back in from the other to where it was parked. One jump a lap,
  // made while it's out of sight, so it never visibly teleports. Distances are CARS below.
  ...['l', 'r'].map((k) => {
    const c = CARS[k], out = c.out, back = c.back, at = +(Math.abs(out) / (Math.abs(out) + Math.abs(back)) * 100).toFixed(2);
    return `.tsx-fly${k}{animation:tsx-fly${k} ${s(+(BAR_SEC * 6).toFixed(3))} linear ${s(t(c.bar))} infinite}` +
      `@keyframes tsx-fly${k}{0%{transform:translateX(0)}${at}%{transform:translateX(${out}px)}${(at + 0.01).toFixed(2)}%{transform:translateX(${back}px)}100%{transform:translateX(0)}}`;
  }),
  `.tsx-carbob{animation:tsx-carbob ${s(BEAT * 4)} ease-in-out infinite alternate}`,
  `@keyframes tsx-carbob{from{transform:translateY(-2px)}to{transform:translateY(2px)}}`,
  // searchlights, from bar 7
  `.tsx-beam{opacity:0;transform-box:view-box;animation:tsx-sweep ${s(BAR_SEC * 4)} ease-in-out ${s(t(7))} infinite alternate}`,
  `.tsx-beam.r{transform-origin:735px 520px}.tsx-beam.l{transform-origin:575px 520px;animation-delay:${s(t(7) + BAR_SEC)};animation-direction:alternate-reverse}`,
  `@keyframes tsx-sweep{0%{opacity:.22;transform:rotate(-18deg)}100%{opacity:.22;transform:rotate(14deg)}}`,
  `.tsx-win{opacity:0;animation-name:tsx-blink;animation-timing-function:steps(1,end);animation-iteration-count:infinite}`,
  `@keyframes tsx-blink{0%{opacity:.9}55%{opacity:.15}100%{opacity:.9}}`,
  // the last chord and the button
  `.tsx-flash{opacity:0;animation:tsx-flash .35s ease-out ${s(t(13))},tsx-flash .5s ease-out ${s(t(14, 12))}}`,
  `@keyframes tsx-flash{0%{opacity:.55}100%{opacity:0}}`,
  `.tsx-pop{opacity:0;transform-box:fill-box;transform-origin:center;animation:tsx-pop .3s ease-out both}`,
  `@keyframes tsx-pop{0%{opacity:0;transform:scale(.2)}20%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.6)}}`,
  `@media (prefers-reduced-motion:reduce){[class^="tsx-"],[class*=" tsx-"]{animation:none!important}.tsx-dark,.tsx-signoff,.tsx-board{opacity:0}.tsx-year{opacity:1}.tsx-ring{stroke-dashoffset:0}}`,
].join('');

const svg = [
  `<svg viewBox="0 0 760 520" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
  `<style>${css}</style>`,
  `<defs>`,
  `<filter id="tsx-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>`,
  // the parked cars' patch: their cut-out made solid white, grown two pixels and softened
  `<filter id="tsx-grow" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 4 0"/><feMorphology operator="dilate" radius="2"/><feGaussianBlur stdDeviation="1"/></filter>`,
  `<filter id="tsx-soft"x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>`,
  `<linearGradient id="tsx-beamg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#cfe8ff" stop-opacity=".9"/><stop offset="1" stop-color="#cfe8ff" stop-opacity="0"/></linearGradient>`,
  `<radialGradient id="tsx-popg"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  ...Object.entries(CARS).map(([k, c]) => `<linearGradient id="tsx-patch${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky[0]}"/><stop offset="1" stop-color="${c.sky[1]}"/></linearGradient>`),
  `<mask id="tsx-sky" maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="520"><rect width="760" height="520" fill="#000"/><rect x="${SKY.x}" y="0" width="${760 - SKY.x}" height="${SKY.bottom}" fill="#fff"/>${BARS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`).join('')}<polygon fill="#000" points="${MAN}"/></mask>`,
  `</defs>`,
  `<rect width="760" height="520" fill="#05060f"/>`,
  `<g class="tsx-cam">`,
  `<image id="tsx-poster" x="0" y="0" width="760" height="520" xlink:href="data:image/jpeg;base64,${jpeg}"/>`,
  // sky over where the two cars are painted, so the copies can leave: the sky colour in the
  // car's own shape (its cut-out, grown a little), so nothing round it is touched and no box shows
  ...Object.entries(CARS).map(([k, c]) => `<mask id="tsx-park${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="520"><image x="${c.box[0]}" y="${c.box[1]}" width="${c.box[2]}" height="${c.box[3]}" filter="url(#tsx-grow)" xlink:href="data:image/png;base64,${carPng(k)}"/></mask>` +
    `<rect x="${c.box[0] - 4}" y="${c.box[1] - 4}" width="${c.box[2] + 8}" height="${c.box[3] + 8}" fill="url(#tsx-patch${k})" mask="url(#tsx-park${k})"/>`),
  // The sky through the studio window: searchlights and traffic, masked to the window and out
  // of John's head and shoulders (tsx-sky), so they pass behind him and never over the wall.
  `<g mask="url(#tsx-sky)">`,
  `<polygon class="tsx-beam r" points="735,520 700,0 770,0" fill="url(#tsx-beamg)" style="mix-blend-mode:screen"/>`,
  `<polygon class="tsx-beam l" points="575,520 545,0 610,0" fill="url(#tsx-beamg)" style="mix-blend-mode:screen"/>`,
  `<circle class="tsx-car a" cx="-30" cy="128" r="3" fill="#ffe2a0" filter="url(#tsx-soft)"/>`,
  `<circle class="tsx-car b" cx="-30" cy="104" r="2.5" fill="#ff7ad9" filter="url(#tsx-soft)"/>`,
  `<circle class="tsx-car c" cx="-30" cy="150" r="2" fill="#9fe6ff" filter="url(#tsx-soft)"/>`,
  // the two cars, as their cut-outs, each with the glow under it
  ...Object.entries({ l: [478, 58, 16, 3, '#7fe8ff'], r: [640, 80, 30, 5, '#ffb347'] }).map(([k, [cx, cy, rx, ry, col]]) => {
    const [x, y, w, h] = CARS[k].box;
    return `<g class="tsx-fly${k}"><g class="tsx-carbob"><ellipse class="tsx-hover" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${col}" filter="url(#tsx-glow)"/>` +
      `<image x="${x}" y="${y}" width="${w}" height="${h}" xlink:href="data:image/png;base64,${carPng(k)}"/></g></g>`;
  }),
  `</g>`,
  ...WINDOWS.map(([x, y, w, h, bar, beats], i) =>
    `<rect class="tsx-win" x="${x}" y="${y}" width="${w}" height="${h}" fill="${i % 3 ? '#ffd37a' : '#7fe8ff'}" style="animation-delay:${s(t(bar, (i * 5) % 16))};animation-duration:${s(+(BEAT * beats).toFixed(3))}"/>`),
  // the dark that strikes off the sign's letters, the board and the year
  `<rect class="tsx-signoff" x="54" y="70" width="218" height="276" fill="#05060f"/>`,
  `<rect class="tsx-board" x="686" y="168" width="64" height="168" fill="#05060f"/>`,
  `<rect class="tsx-planet" x="692" y="336" width="56" height="88" fill="#c06bff" filter="url(#tsx-glow)" style="mix-blend-mode:screen"/>`,
  // the year sign: a plate over the poster's 2107, lettered with tonight's year ({year}, filled
  // in on air by the broadcast runner from the in-game date), lit at bar 7
  `<rect x="562" y="418" width="66" height="36" rx="3" fill="#0d0a24" stroke="#2a2160" stroke-width="1.5"/>`,
  `<g class="tsx-year"><text x="595" y="444" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="21" fill="#ff6fd8" filter="url(#tsx-soft)" opacity=".7">{year}</text><text x="595" y="444" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="21" fill="#ffd2f4">{year}</text></g>`,
  `<rect class="tsx-dark" width="760" height="520" fill="#03040a"/>`,
  // the ring and its halo over the dark, so it draws itself in a black studio
  `<ellipse class="tsx-halo" cx="146" cy="203" rx="152" ry="198" fill="#29b6ff" filter="url(#tsx-glow)" style="mix-blend-mode:screen"/>`,
  `<ellipse class="tsx-ring" cx="146" cy="203" rx="140" ry="188" fill="none" stroke="#6fe3ff" stroke-width="6" filter="url(#tsx-soft)" style="mix-blend-mode:screen"/>`,
  ...FLASHES.map(([x, y, bar, row]) => `<circle class="tsx-pop" cx="${x}" cy="${y}" r="16" fill="url(#tsx-popg)" style="animation-delay:${s(t(bar, row))}"/>`),
  `<rect class="tsx-flash" width="760" height="520" fill="#fff"/>`,
  `</g>`,
  `</svg>`,
].join('');

// {year} is the one token the card means to carry; any other {word} would be substituted by mistake.
if (/\{(?!year\})\w+\}/.test(svg)) throw new Error('the card carries a {word}, which the broadcast runner would substitute');

// ── write ───────────────────────────────────────────────────────────────────
if (PRINT) { process.stdout.write(svg); process.exit(0); }
let stale = 0;
if (lines[at + 1] !== svg) {
  stale++;
  if (CHECK) console.error(`✗ ${BSM}: the tonight_show_logo asset is behind this script`);
  else { lines[at + 1] = svg; fs.writeFileSync(path.join(ROOT, BSM), lines.join(NL), 'utf8'); console.log(`  wrote ${BSM}`); }
}
const rowPath = path.join(ROOT, ROW_JSON);
const row = JSON.parse(fs.readFileSync(rowPath, 'utf8'));
if (row.content !== svg) {
  stale++;
  if (CHECK) console.error(`✗ ${ROW_JSON} is behind this script`);
  else { row.content = svg; fs.writeFileSync(rowPath, canonicalJson(row), 'utf8'); console.log(`  wrote ${ROW_JSON}`); }
}
if (CHECK && stale) process.exit(1);
console.log(`${CHECK ? '✓ up to date' : '✓ built'}: tonight_show_logo, ${(svg.length / 1024).toFixed(0)} KB, timed to a ${BAR_SEC.toFixed(3)} s bar`);
